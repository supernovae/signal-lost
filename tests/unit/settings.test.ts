import { describe, expect, it } from 'vitest';
import { applyPreferences, effectiveMotion, type Preferences } from '../../src/app/settings.ts';

const preferences = (over: Partial<Preferences> = {}): Preferences => ({
  muted: false,
  reducedMotion: null,
  effects: true,
  ...over,
});

describe('effectiveMotion', () => {
  it.each([
    [null, false, true],
    [null, true, false],
    [true, false, false],
    [false, true, true],
  ])('choice %j with system reduced %j gives motion %j', (reducedMotion, system, expected) => {
    expect(effectiveMotion(preferences({ reducedMotion }), system)).toBe(expected);
  });
});

describe('applyPreferences', () => {
  it('forwards every preference', () => {
    const calls: unknown[] = [];
    applyPreferences(preferences({ muted: true, effects: false }), true, {
      setMuted: (value) => calls.push(['muted', value]),
      setMotion: (value) => calls.push(['motion', value]),
      setAttribute: (name, value) => calls.push([name, value]),
    });
    expect(calls).toEqual([
      ['muted', true],
      ['motion', false],
      ['motion', 'off'],
      ['effects', 'off'],
    ]);
  });
});
