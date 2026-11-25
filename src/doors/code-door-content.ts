import {
  describeRepairManifest,
  parseDoorContent,
  repairManifestFact,
  repairManifestPath,
  repairManifestSchema,
} from '../content/repair-manifest.ts';

export { parseDoorContent };

const assets = import.meta.glob<string>('/content/code-doors/manifest-r07-spool-02.jsonc', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const signed = repairManifestSchema.parse(parseDoorContent(assets[`/${repairManifestPath}`]!));
export const manifest = { ...signed, lines: describeRepairManifest(signed) };
export const manifestFact = repairManifestFact(signed);
