import type { CarrierSignal } from '../content/schema.ts';
import { mulberry32 } from './rng.ts';

const HZ_PER_MHZ = 1_000_000;

/** The bin a track occupies at a row, or a value outside 0..bins-1 when off band. */
export function trackBin(
  signal: CarrierSignal,
  freqMhz: number,
  driftHzPerSec: number,
  row: number,
): number {
  const offsetHz = (freqMhz - signal.startMhz) * HZ_PER_MHZ;
  return Math.round((offsetHz + driftHzPerSec * row * signal.secondsPerRow) / signal.binHz);
}

/** Detected power, rows x bins, in row order. Fully determined by the signal parameters. */
export function generateWaterfall(signal: CarrierSignal): Float32Array {
  const { rows, bins, noiseFloor } = signal;
  const random = mulberry32(signal.seed);
  const samples = new Float32Array(rows * bins);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = -noiseFloor * Math.log(1 - random());
  }
  for (const line of signal.lines) {
    for (let row = 0; row < rows; row++) {
      const bin = trackBin(signal, line.freqMhz, line.driftHzPerSec, row);
      if (bin >= 0 && bin < bins) samples[row * bins + bin]! += line.amplitude;
    }
  }
  return samples;
}
