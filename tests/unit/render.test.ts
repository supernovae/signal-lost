import { describe, expect, it, vi } from 'vitest';
import { createRenderHost } from '../../src/render/host.ts';
import { createLoop } from '../../src/render/loop.ts';

function fakeLoop() {
  const pending = new Map<number, (time: number) => void>();
  let next = 1;
  const draw = vi.fn();
  const loop = createLoop({
    draw,
    schedule(callback) {
      pending.set(next, callback);
      return next++;
    },
    cancel: (handle) => pending.delete(handle),
  });
  const tick = (time: number): void => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(time));
  };
  return { loop, draw, pending, tick };
}

describe('render loop', () => {
  it('schedules frames while running and passes elapsed seconds', () => {
    const { loop, draw, pending, tick } = fakeLoop();
    expect(pending.size).toBe(0);
    loop.start();
    tick(1000);
    tick(1500);
    expect(draw).toHaveBeenLastCalledWith(0.5);
    expect(pending.size).toBe(1);
  });

  it.each([
    ['stopped', (l: ReturnType<typeof createLoop>) => l.stop()],
    ['hidden', (l: ReturnType<typeof createLoop>) => l.setVisible(false)],
    ['motion off', (l: ReturnType<typeof createLoop>) => l.setMotion(false)],
    ['disposed', (l: ReturnType<typeof createLoop>) => l.dispose()],
  ])('schedules nothing when %s', (_name, act) => {
    const { loop, pending } = fakeLoop();
    loop.start();
    act(loop);
    expect(pending.size).toBe(0);
  });

  it('draws one still frame with motion off', () => {
    const { loop, draw, pending } = fakeLoop();
    loop.setMotion(false);
    loop.start();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
  });
});

describe('render host', () => {
  const fake = () => ({ start: vi.fn(), dispose: vi.fn() });

  it('starts the environment once it loads', async () => {
    const environment = fake();
    const host = createRenderHost(async () => environment, vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(environment.start).toHaveBeenCalledOnce();
    host.dispose();
    expect(environment.dispose).toHaveBeenCalledOnce();
  });

  it('never starts an environment that arrives after disposal', async () => {
    const environment = fake();
    let resolve!: (value: typeof environment) => void;
    const host = createRenderHost(
      () => new Promise<typeof environment>((r) => (resolve = r)),
      vi.fn(),
    );
    host.dispose();
    resolve(environment);
    await Promise.resolve();
    await Promise.resolve();
    expect(environment.start).not.toHaveBeenCalled();
    expect(environment.dispose).toHaveBeenCalledOnce();
  });

  it('reports load failure', async () => {
    const onFailure = vi.fn();
    createRenderHost(
      () => Promise.reject<ReturnType<typeof fake>>(new Error('no webgl')),
      onFailure,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
