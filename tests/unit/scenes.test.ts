import { describe, expect, it } from 'vitest';
import { createSceneManager, type Scene } from '../../src/app/scenes.ts';

describe('scene manager', () => {
  const recording = (name: string, log: string[]): Scene => ({
    mount: () => log.push(`mount ${name}`),
    dispose: () => log.push(`dispose ${name}`),
  });

  it('disposes the old scene before mounting the next, and the last on dispose', () => {
    const log: string[] = [];
    const manager = createSceneManager();
    manager.show(recording('a', log));
    manager.show(recording('b', log));
    manager.dispose();
    manager.dispose();
    expect(log).toEqual(['mount a', 'dispose a', 'mount b', 'dispose b']);
  });
});
