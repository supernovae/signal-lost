import { describe, expect, it } from 'vitest';
import { applyPreferences, effectiveMotion, type Preferences } from '../../src/app/settings.ts';
import { bbsThemeIds, bbsThemes } from '../../src/bbs/themes.ts';

const preferences = (over: Partial<Preferences> = {}): Preferences => ({
  muted: false,
  reducedMotion: null,
  effects: true,
  bbsTheme: 'amber',
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
    applyPreferences(preferences({ muted: true, effects: false, bbsTheme: 'ansi' }), true, {
      setMuted: (value) => calls.push(['muted', value]),
      setMotion: (value) => calls.push(['motion', value]),
      setBbsTheme: (value) => calls.push(['theme', value]),
      setAttribute: (name, value) => calls.push([name, value]),
    });
    expect(calls).toEqual([
      ['muted', true],
      ['motion', false],
      ['theme', 'ansi'],
      ['motion', 'off'],
      ['effects', 'off'],
    ]);
  });
});

function luminance(hex: string): number {
  const channel = (index: number) => {
    const s = parseInt(hex.slice(index, index + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(first: string, second: string): number {
  expect(first).toMatch(/^#[a-f0-9]{6}$/i);
  expect(second).toMatch(/^#[a-f0-9]{6}$/i);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

it.each(bbsThemeIds)('%s meets WCAG AA for text and focus in the actual BBS palette', (id) => {
  const { surface, text, dim, control, hover, selected, field, focus, tones, origins } =
    bbsThemes[id];
  const logColors = { text, dim, ...tones };
  for (const [label, color] of Object.entries(logColors)) {
    expect(contrast(color, surface), label).toBeGreaterThanOrEqual(4.5);
  }
  for (const [label, badge] of Object.entries(origins)) {
    expect(contrast(badge.text, badge.background), label).toBeGreaterThanOrEqual(4.5);
  }
  for (const [label, background] of Object.entries({ surface, control, hover, selected, field })) {
    expect(contrast(text, background), label).toBeGreaterThanOrEqual(4.5);
    expect(contrast(focus, background), label).toBeGreaterThanOrEqual(3);
  }
});
