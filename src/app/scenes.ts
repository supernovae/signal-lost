export interface Scene {
  mount(): void;
  dispose(): void;
}

export interface SceneManager {
  show(scene: Scene): void;
  dispose(): void;
}

/** Holds one scene at a time, disposing the old scene before the new one mounts. */
export function createSceneManager(): SceneManager {
  let current: Scene | undefined;
  return {
    show(scene) {
      current?.dispose();
      current = scene;
      scene.mount();
    },
    dispose() {
      current?.dispose();
      current = undefined;
    },
  };
}
