import type { CarrierSignal } from '../content/schema.ts';
import { trackBin } from './waterfall.ts';

export interface TuneSettings {
  tuneMhz: number;
  bandwidthHz: number;
  driftHzPerSec: number;
}

/** Signal-to-noise of the power collected along the chosen drift line. */
export function measureSnr(
  signal: CarrierSignal,
  samples: Float32Array,
  settings: TuneSettings,
): number {
  const { rows, bins, binHz, noiseFloor } = signal;
  const width = Math.max(1, Math.round(settings.bandwidthHz / binHz));
  const first = -Math.floor((width - 1) / 2);
  let sum = 0;
  let count = 0;
  for (let row = 0; row < rows; row++) {
    const center = trackBin(signal, settings.tuneMhz, settings.driftHzPerSec, row);
    for (let i = 0; i < width; i++) {
      const bin = center + first + i;
      if (bin >= 0 && bin < bins) {
        sum += samples[row * bins + bin]!;
        count++;
      }
    }
  }
  if (count === 0) return 0;
  return (sum - count * noiseFloor) / (noiseFloor * Math.sqrt(count));
}

/** Mean power per bin after shifting each row by the drift: true lines sharpen. */
export function integratedSpectrum(
  signal: CarrierSignal,
  samples: Float32Array,
  driftHzPerSec: number,
): Float32Array {
  const { rows, bins, binHz, secondsPerRow } = signal;
  const totals = new Float32Array(bins);
  const counts = new Uint16Array(bins);
  for (let row = 0; row < rows; row++) {
    const shift = Math.round((driftHzPerSec * row * secondsPerRow) / binHz);
    for (let bin = 0; bin < bins; bin++) {
      const source = bin + shift;
      if (source >= 0 && source < bins) {
        totals[bin]! += samples[row * bins + source]!;
        counts[bin]!++;
      }
    }
  }
  return totals.map((total, bin) => (counts[bin]! > 0 ? total / counts[bin]! : 0));
}
