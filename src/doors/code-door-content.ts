import { z } from 'zod';

const assets = import.meta.glob<string>('/content/code-doors/manifest-r07-spool-02.jsonc', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export function parseDoorContent(raw: string): unknown {
  // Prettier adds trailing commas to JSONC. Keep commas inside quoted strings intact.
  const json = raw.replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g, (token) =>
    token === ',' ? '' : token,
  );
  return JSON.parse(json);
}

const line = z.string().min(1);
export const manifest = z
  .strictObject({ id: line, target: line, lines: z.array(line).min(1) })
  .parse(parseDoorContent(assets['/content/code-doors/manifest-r07-spool-02.jsonc']!));
export const manifestFact = `flag:manifest-${manifest.id.toLowerCase()}`;
