export const CONTENT_SCHEMA_VERSION = 1;

export interface ManifestEntry {
  kind: string;
  id: string;
  file: string;
}

export interface Manifest {
  schemaVersion: number;
  contentVersion: string;
  entries: ManifestEntry[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FNV-1a over canonical JSON: stable across key order, changes with content. */
export function hashContent(files: Record<string, unknown>): string {
  let hash = 0x811c9dc5;
  for (const path of Object.keys(files).sort()) {
    const input = `${path}\n${canonical(files[path])}\n`;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
