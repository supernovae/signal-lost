import type { BbsTone } from '../content/schema.ts';

export const bbsThemeIds = ['amber', 'ansi', 'high-readability'] as const;
export type BbsTheme = (typeof bbsThemeIds)[number];

interface Palette {
  surface: string;
  text: string;
  dim: string;
  control: string;
  hover: string;
  selected: string;
  field: string;
  focus: string;
  tones: Record<BbsTone, string>;
  origins: Record<'fictional' | 'reviewed-community', { text: string; background: string }>;
}

export const bbsThemes: Record<BbsTheme, Palette> = {
  amber: {
    surface: '#150e0a',
    text: '#ffd08a',
    dim: '#d8b393',
    control: '#21160e',
    hover: '#39271c',
    selected: '#3b2a12',
    field: '#201712',
    focus: '#ffdd9d',
    tones: {
      system: '#ffcc7b',
      history: '#f8d9a8',
      sysop: '#f3c0ff',
      'ai-fictional': '#f3c0ff',
      recovered: '#bbe5ec',
      private: '#ffd3bf',
      door: '#cdeba6',
      'network-error': '#ffad9c',
      restricted: '#f6c47e',
    },
    origins: {
      fictional: { text: '#ffe5c7', background: '#352319' },
      'reviewed-community': { text: '#b9f4e4', background: '#15352c' },
    },
  },
  ansi: {
    surface: '#0c1228',
    text: '#e0e9ff',
    dim: '#b1c0de',
    control: '#17213c',
    hover: '#29395e',
    selected: '#303361',
    field: '#161b35',
    focus: '#fbe881',
    tones: {
      system: '#82e5ff',
      history: '#fff0a8',
      sysop: '#e6b9ff',
      'ai-fictional': '#e6b9ff',
      recovered: '#9fd6ff',
      private: '#ffb9e4',
      door: '#a9fab4',
      'network-error': '#ffadbb',
      restricted: '#ffc49f',
    },
    origins: {
      fictional: { text: '#e7eeff', background: '#28324f' },
      'reviewed-community': { text: '#a9fab4', background: '#163a38' },
    },
  },
  'high-readability': {
    surface: '#101216',
    text: '#ffffff',
    dim: '#e0e3e8',
    control: '#20242b',
    hover: '#31363f',
    selected: '#343b4a',
    field: '#1b2028',
    focus: '#ffde72',
    tones: {
      system: '#d4f4ff',
      history: '#fff1cc',
      sysop: '#f3dcff',
      'ai-fictional': '#f3dcff',
      recovered: '#c3ebff',
      private: '#ffdeed',
      door: '#d6ffdc',
      'network-error': '#ffd4d4',
      restricted: '#ffe0b9',
    },
    origins: {
      fictional: { text: '#ffffff', background: '#343844' },
      'reviewed-community': { text: '#e0ffed', background: '#1b4233' },
    },
  },
};

export function bbsThemeStyles(theme: BbsTheme): Record<string, string> {
  const { tones, origins, ...base } = bbsThemes[theme];
  return Object.fromEntries([
    ...Object.entries(base).map(([name, value]) => [`--bbs-${name}`, value]),
    ...Object.entries(tones).map(([name, value]) => [`--bbs-tone-${name}`, value]),
    ...Object.entries(origins).flatMap(([name, { text, background }]) => [
      [`--bbs-origin-${name}-text`, text],
      [`--bbs-origin-${name}-background`, background],
    ]),
  ]);
}
