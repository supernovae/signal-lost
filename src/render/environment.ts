import * as THREE from 'three';
import { createLoop } from './loop.ts';

export interface Environment {
  start(): void;
  stop(): void;
  setMotion(enabled: boolean): void;
  dispose(): void;
}

const RENDER_SCALE = 1 / 3;
const AMBER = 0xffb347;
const DEEP_SPACE = 0x050914;

/** Snaps vertices to a coarse screen grid, the wobble of PS1-era hardware. */
function snapVertices(material: THREE.Material, gridSize: number): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      gl_Position.xy = floor(gl_Position.xy / gl_Position.w * ${gridSize.toFixed(1)}) /
        ${gridSize.toFixed(1)} * gl_Position.w;`,
    );
  };
}

function createStars(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Fixed golden-angle spiral: the sky is identical on every visit.
    const y = 1 - (2 * (i + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    const angle = i * 2.399963;
    const distance = 60 + (i % 7) * 6;
    positions[i * 3] = Math.cos(angle) * radius * distance;
    positions[i * 3 + 1] = y * distance;
    positions[i * 3 + 2] = Math.sin(angle) * radius * distance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x9fb4c8, size: 0.9, sizeAttenuation: true });
  return new THREE.Points(geometry, material);
}

/** Throws when WebGL is unavailable, so the caller can use the static fallback. */
export function createEnvironment(
  canvas: HTMLCanvasElement,
  options: { motion: boolean },
): Environment {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(RENDER_SCALE);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEEP_SPACE);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0.6, 7);

  scene.add(new THREE.AmbientLight(0x38465a, 1.4));
  const key = new THREE.DirectionalLight(AMBER, 2.4);
  key.position.set(-4, 3, 5);
  scene.add(key);

  const stars = createStars(1400);
  scene.add(stars);

  const source = new THREE.Group();
  const coreMaterial = new THREE.MeshLambertMaterial({ color: 0x8a7a68, flatShading: true });
  snapVertices(coreMaterial, 120);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), coreMaterial);
  const ringMaterial = new THREE.MeshLambertMaterial({ color: AMBER, flatShading: true });
  snapVertices(ringMaterial, 120);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.05, 3, 18), ringMaterial);
  ring.rotation.x = 1.25;
  source.add(core, ring);
  source.position.x = 1.6;
  scene.add(source);

  // The analyzer sweep: a thin bar crossing the view on a fixed cycle.
  const sweepMaterial = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
  });
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 12), sweepMaterial);
  sweep.position.z = 2;
  scene.add(sweep);

  let elapsed = 0;
  const loop = createLoop({
    draw(delta) {
      elapsed += delta;
      source.rotation.y += delta * 0.18;
      ring.rotation.z += delta * 0.35;
      stars.rotation.y += delta * 0.004;
      sweep.position.x = -5 + ((elapsed * 1.1) % 10);
      renderer.render(scene, camera);
    },
    schedule: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  });

  const resize = (): void => {
    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const onVisibility = (): void => loop.setVisible(!document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  loop.setMotion(options.motion);

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    setMotion: (enabled) => loop.setMotion(enabled),
    dispose() {
      loop.dispose();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
    },
  };
}
