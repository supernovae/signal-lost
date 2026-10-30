import type { CarrierPuzzle } from '../content/schema.ts';
import { integratedSpectrum, measureSnr, type TuneSettings } from './integrate.ts';
import { evaluateLock, type LockResult } from './lock.ts';
import { generateWaterfall } from './waterfall.ts';

const HZ_PER_MHZ = 1_000_000;
const DRIFT_RANGE = 1;
const DRIFT_STEP = 0.02;

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.append(text, control);
  return label;
}

function drawWaterfall(
  canvas: HTMLCanvasElement,
  puzzle: CarrierPuzzle,
  samples: Float32Array,
): void {
  const { rows, bins, noiseFloor } = puzzle.signal;
  canvas.width = bins;
  canvas.height = rows;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(bins, rows);
  for (let i = 0; i < samples.length; i++) {
    const level = Math.min(1, samples[i]! / (noiseFloor * 5));
    image.data[i * 4] = 255 * level;
    image.data[i * 4 + 1] = 179 * level * level;
    image.data[i * 4 + 2] = 71 * level * level * level + 20;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export function openAnalyzer(
  panel: HTMLElement,
  puzzle: CarrierPuzzle,
  onResult: (result: LockResult) => void,
): void {
  const { signal, bandwidthsHz } = puzzle;
  const samples = generateWaterfall(signal);

  const waterfall = document.createElement('canvas');
  waterfall.className = 'waterfall';
  waterfall.setAttribute('role', 'img');
  waterfall.setAttribute('aria-label', 'Waterfall: frequency across, time downward');
  drawWaterfall(waterfall, puzzle, samples);

  const overlay = document.createElement('canvas');
  overlay.className = 'waterfall-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.width = signal.bins;
  overlay.height = signal.rows;

  const stack = document.createElement('div');
  stack.className = 'waterfall-stack';
  stack.append(waterfall, overlay);

  const spectrum = document.createElement('canvas');
  spectrum.className = 'spectrum';
  spectrum.setAttribute('role', 'img');
  spectrum.setAttribute('aria-label', 'Integrated spectrum at the current drift');
  spectrum.width = signal.bins;
  spectrum.height = 60;

  const tune = document.createElement('input');
  tune.type = 'range';
  tune.min = '0';
  tune.max = String(signal.bins - 1);
  tune.step = '1';
  tune.value = String(Math.floor(signal.bins / 8));

  const drift = document.createElement('input');
  drift.type = 'range';
  drift.min = String(-DRIFT_RANGE);
  drift.max = String(DRIFT_RANGE);
  drift.step = String(DRIFT_STEP);
  drift.value = '0';

  const bandwidth = document.createElement('select');
  for (const hz of [...bandwidthsHz].sort((a, b) => b - a)) {
    bandwidth.add(new Option(`${hz} HZ`, String(hz)));
  }

  const readout = document.createElement('output');
  readout.className = 'analyzer-readout';
  readout.setAttribute('aria-live', 'off');

  const lock = document.createElement('button');
  lock.type = 'button';
  lock.textContent = 'LOCK';

  const settings = (): TuneSettings => ({
    tuneMhz: signal.startMhz + (Number(tune.value) * signal.binHz) / HZ_PER_MHZ,
    bandwidthHz: Number(bandwidth.value),
    driftHzPerSec: Number(drift.value),
  });

  const update = (): void => {
    const current = settings();
    const snr = measureSnr(signal, samples, current);
    const driftText = current.driftHzPerSec.toFixed(2);
    readout.textContent = `${current.tuneMhz.toFixed(6)} MHZ  DRIFT ${driftText} HZ/S  SNR ${snr.toFixed(1)}`;
    drawTrack(overlay, puzzle, Number(tune.value), current.driftHzPerSec);
    drawSpectrum(spectrum, puzzle, integratedSpectrum(signal, samples, current.driftHzPerSec));
  };

  tune.addEventListener('input', update);
  drift.addEventListener('input', update);
  bandwidth.addEventListener('change', update);
  lock.addEventListener('click', () => onResult(evaluateLock(puzzle, samples, settings())));

  const controls = document.createElement('div');
  controls.className = 'analyzer-controls';
  controls.append(
    labelled('TUNE', tune),
    labelled('DRIFT', drift),
    labelled('BANDWIDTH', bandwidth),
    readout,
    lock,
  );

  panel.replaceChildren(stack, spectrum, controls);
  update();
}

function drawTrack(
  canvas: HTMLCanvasElement,
  puzzle: CarrierPuzzle,
  tuneBin: number,
  driftHzPerSec: number,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { rows, binHz, secondsPerRow } = puzzle.signal;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#7fe0c8';
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(tuneBin + 0.5, 0);
  context.lineTo(tuneBin + 0.5 + (driftHzPerSec * rows * secondsPerRow) / binHz, rows);
  context.stroke();
}

function drawSpectrum(
  canvas: HTMLCanvasElement,
  puzzle: CarrierPuzzle,
  values: Float32Array,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { noiseFloor } = puzzle.signal;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffb347';
  values.forEach((value, bin) => {
    const level = Math.min(1, Math.max(0, (value - noiseFloor) / (noiseFloor * 2)));
    const bar = Math.max(1, level * height);
    context.fillRect(bin, height - bar, 1, bar);
  });
}
