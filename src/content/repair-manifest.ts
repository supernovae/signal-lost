import { z } from 'zod';

export const repairManifestPath = 'content/code-doors/manifest-r07-spool-02.jsonc';

export function parseDoorContent(raw: string): unknown {
  // Prettier adds trailing commas to JSONC. Keep commas inside quoted strings intact.
  const json = raw.replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g, (token) =>
    token === ',' ? '' : token,
  );
  return JSON.parse(json);
}

export const repairOperations = ['REPLAY', 'RESET'] as const;
export const evidenceModes = ['PRESERVE', 'REPLACE'] as const;
export const sealLabel = z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/);
export const retainedModuleSchema = z.strictObject({
  name: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
  seal: sealLabel,
  boundary: z.enum(['complete', 'partial']),
  dependencies: z.array(sealLabel),
});

export const repairManifestSchema = z.strictObject({
  id: sealLabel,
  target: sealLabel,
  signature: z.literal('VERIFIED'),
  modules: z.array(retainedModuleSchema.extend({ boundary: z.literal('complete') })).min(1),
  terms: z.strictObject({
    operation: z.literal(repairOperations[0]),
    evidenceMode: z.literal(evidenceModes[0]),
    destination: z.literal('separate replay copy'),
    originals: z.literal('Preserve sealed originals unchanged.'),
  }),
  sufficiency: z.string().min(1),
});

export type RepairManifest = z.infer<typeof repairManifestSchema>;

export const repairManifestFact = ({ id }: RepairManifest): string =>
  `flag:manifest-${id.toLowerCase()}`;

export function describeModule({
  name,
  seal,
  dependencies,
}: Pick<RepairManifest['modules'][number], 'name' | 'seal' | 'dependencies'>): string {
  return `${seal} / ${name} | REQUIRES: ${dependencies.join(' and ') || 'none'}`;
}

export function describeRepairManifest(manifest: RepairManifest): string[] {
  return [
    `SIGNED REPAIR MANIFEST ${manifest.id}`,
    `TARGET: ${manifest.target} | SIGNATURE: ${manifest.signature}`,
    ...manifest.modules.map(describeModule),
    `BUILD ORDER: ${manifest.modules.map(({ seal }) => seal).join(' → ')}`,
    manifest.sufficiency,
    `DESTINATION: ${manifest.terms.destination}. ${manifest.terms.originals}`,
  ];
}
