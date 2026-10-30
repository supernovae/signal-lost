export interface LoopOptions {
  draw(deltaSeconds: number): void;
  schedule(callback: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

export interface Loop {
  start(): void;
  stop(): void;
  setMotion(enabled: boolean): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Schedules frames only while they are needed. Without motion it draws one still frame. */
export function createLoop({ draw, schedule, cancel }: LoopOptions): Loop {
  let running = false;
  let motion = true;
  let visible = true;
  let disposed = false;
  let handle: number | undefined;
  let lastTime: number | undefined;

  const clear = (): void => {
    if (handle !== undefined) cancel(handle);
    handle = undefined;
    lastTime = undefined;
  };
  const frame = (time: number): void => {
    handle = undefined;
    draw(lastTime === undefined ? 0 : (time - lastTime) / 1000);
    lastTime = time;
    if (running && motion && visible && !disposed) handle = schedule(frame);
  };
  const update = (): void => {
    clear();
    if (disposed || !running || !visible) return;
    if (motion) handle = schedule(frame);
    else draw(0);
  };

  return {
    start() {
      running = true;
      update();
    },
    stop() {
      running = false;
      update();
    },
    setMotion(enabled) {
      motion = enabled;
      update();
    },
    setVisible(value) {
      visible = value;
      update();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
