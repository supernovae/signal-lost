import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { puzzleSchema, type CarrierPuzzle, type CarrierSignal } from '../../src/content/schema.ts';
import { integratedSpectrum, measureSnr } from '../../src/signal/integrate.ts';
import { evaluateLock } from '../../src/signal/lock.ts';
import { generateWaterfall } from '../../src/signal/waterfall.ts';

const puzzle = puzzleSchema.parse(
  JSON.parse(readFileSync('content/puzzles/carrier.json', 'utf8')),
) as CarrierPuzzle;
const samples = generateWaterfall(puzzle.signal);
const SOLUTION = { tuneMhz: 1421.37, driftHzPerSec: -0.42, bandwidthHz: 5 };

describe('determinism', () => {
  it('produces identical samples from the same seed, and different ones otherwise', () => {
    expect(generateWaterfall(puzzle.signal)).toEqual(samples);
    const other = { ...puzzle.signal, seed: puzzle.signal.seed + 1 };
    expect(generateWaterfall(other)).not.toEqual(samples);
  });
});

describe('the carrier puzzle', () => {
  it('locks at the solution', () => {
    const result = evaluateLock(puzzle, samples, SOLUTION);
    expect(result.outcome).toBe('locked');
    expect(result.snr).toBeGreaterThan(puzzle.solution.minSnr);
  });

  it.each([
    ['tune one step off', { ...SOLUTION, tuneMhz: 1421.370005 }],
    ['drift one step off', { ...SOLUTION, driftHzPerSec: -0.4 }],
    ['opposite drift', { ...SOLUTION, driftHzPerSec: 0.42 }],
    ['no drift', { ...SOLUTION, driftHzPerSec: 0 }],
    ['20 Hz bandwidth', { ...SOLUTION, bandwidthHz: 20 }],
    ['100 Hz bandwidth', { ...SOLUTION, bandwidthHz: 100 }],
  ])('does not lock with %s', (_name, settings) => {
    const result = evaluateLock(puzzle, samples, settings);
    expect(result.outcome).not.toBe('locked');
    expect(result.snr).toBeLessThan(puzzle.solution.minSnr);
  });

  it.each([1421.3695, 1421.3706])(
    'rejects the strong fixed line at %f as terrestrial',
    (tuneMhz) => {
      const result = evaluateLock(puzzle, samples, { tuneMhz, driftHzPerSec: 0, bandwidthHz: 5 });
      expect(result.snr).toBeGreaterThan(puzzle.solution.minSnr);
      expect(result.outcome).toBe('terrestrial');
    },
  );

  it('has distinct feedback for every failure', () => {
    const { terrestrial, weak, noLine } = puzzle.feedback;
    expect(new Set([terrestrial[0], weak[0], noLine[0]]).size).toBe(3);
  });

  it('locks only at the exact solution across the whole control grid', () => {
    const { startMhz, bins, binHz } = puzzle.signal;
    const locked: string[] = [];
    for (const bandwidthHz of puzzle.bandwidthsHz) {
      for (let bin = 0; bin < bins; bin++) {
        const tuneMhz = startMhz + (bin * binHz) / 1_000_000;
        for (let step = -50; step <= 50; step++) {
          const driftHzPerSec = step / 50;
          const result = evaluateLock(puzzle, samples, { tuneMhz, driftHzPerSec, bandwidthHz });
          if (result.outcome === 'locked') {
            locked.push(`${tuneMhz.toFixed(6)}/${driftHzPerSec}/${bandwidthHz}`);
          }
        }
      }
    }
    expect(locked).toEqual(['1421.370000/-0.42/5']);
  });

  it('sharpens the true line only when the drift is cancelled', () => {
    const targetBin = 200;
    const atSolution = integratedSpectrum(puzzle.signal, samples, -0.42)[targetBin]!;
    const uncancelled = integratedSpectrum(puzzle.signal, samples, 0)[targetBin]!;
    expect(atSolution).toBeGreaterThan(uncancelled + 0.5);
  });
});

describe('band edges', () => {
  const small: CarrierSignal = {
    seed: 1,
    startMhz: 100,
    binHz: 1,
    bins: 10,
    rows: 4,
    secondsPerRow: 1,
    noiseFloor: 1,
    lines: [{ freqMhz: 100, driftHzPerSec: 0, amplitude: 1, terrestrial: false }],
  };
  // Every sample is exactly 2, so SNR reveals how many samples were counted: SNR = sqrt(n).
  const flat = new Float32Array(40).fill(2);
  const settings = { tuneMhz: 100, bandwidthHz: 1, driftHzPerSec: 0 };

  it('counts only in-band samples in a partially clipped window', () => {
    const snr = measureSnr(small, flat, { ...settings, bandwidthHz: 3 });
    expect(snr).toBeCloseTo(Math.sqrt(8));
  });

  it('counts fewer rows when a track leaves the band', () => {
    const snr = measureSnr(small, flat, { ...settings, driftHzPerSec: -1 });
    expect(snr).toBeCloseTo(1);
  });

  it('gives a finite zero for a track entirely out of band, which cannot lock', () => {
    expect(measureSnr(small, flat, { ...settings, tuneMhz: 50 })).toBe(0);
    const lockable = {
      ...puzzle,
      signal: small,
      solution: { minSnr: 0.5, toleranceHz: 1 },
    };
    expect(evaluateLock(lockable, flat, { ...settings, tuneMhz: 50 }).outcome).toBe('no-line');
  });
});
