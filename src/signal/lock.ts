import type { CarrierPuzzle } from '../content/schema.ts';
import { measureSnr, type TuneSettings } from './integrate.ts';

export type LockOutcome = 'locked' | 'terrestrial' | 'weak' | 'no-line';

export interface LockResult {
  outcome: LockOutcome;
  snr: number;
}

export function evaluateLock(
  puzzle: CarrierPuzzle,
  samples: Float32Array,
  settings: TuneSettings,
): LockResult {
  const snr = measureSnr(puzzle.signal, samples, settings);
  const distanceHz = (freqMhz: number): number => Math.abs(freqMhz - settings.tuneMhz) * 1_000_000;
  const nearest = [...puzzle.signal.lines].sort(
    (a, b) => distanceHz(a.freqMhz) - distanceHz(b.freqMhz),
  )[0]!;

  if (snr >= puzzle.solution.minSnr) {
    return { outcome: nearest.terrestrial ? 'terrestrial' : 'locked', snr };
  }
  return {
    outcome: distanceHz(nearest.freqMhz) <= puzzle.solution.toleranceHz ? 'weak' : 'no-line',
    snr,
  };
}
