export interface Disposable {
  start(): void;
  dispose(): void;
}

export interface RenderHost<T extends Disposable> {
  dispose(): void;
  readonly environment: T | undefined;
}

/**
 * Owns the environment across an asynchronous load. One that arrives after the
 * host was disposed is disposed immediately and never started.
 */
export function createRenderHost<T extends Disposable>(
  load: () => Promise<T>,
  onFailure: (error: unknown) => void,
): RenderHost<T> {
  let environment: T | undefined;
  let disposed = false;
  load().then(
    (loaded) => {
      if (disposed) {
        loaded.dispose();
        return;
      }
      environment = loaded;
      loaded.start();
    },
    (error: unknown) => {
      if (!disposed) onFailure(error);
    },
  );
  return {
    get environment() {
      return environment;
    },
    dispose() {
      disposed = true;
      environment?.dispose();
      environment = undefined;
    },
  };
}
