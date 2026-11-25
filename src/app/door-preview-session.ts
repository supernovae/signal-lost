import { doorMetadataSchema } from '../content/schema.ts';
import { formatErrors, parseContentJson, validateDoorById } from '../content/validate.ts';
import { createDoorAuthoringHost } from '../doors/authoring.ts';
import type { DoorScreen } from '../doors/contract.ts';
import type { DoorHost } from '../doors/host.ts';

type DoorPreview =
  { kind: 'screen'; screen: DoorScreen; host: DoorHost } | { kind: 'error'; lines: string[] };

export async function openDoorPreview(
  search: string,
  rawContent: Record<string, string>,
): Promise<DoorPreview> {
  const ids = new URLSearchParams(search).getAll('id');
  const id = doorMetadataSchema.shape.id.safeParse(ids[0]);
  if (ids.length !== 1 || !id.success) {
    return { kind: 'error', lines: ['Supply exactly one valid door ID with ?id=<door-id>.'] };
  }

  const files = Object.fromEntries(
    Object.entries(rawContent).map(([path, text]) => [
      path.replace(/^\//, ''),
      parseContentJson(text),
    ]),
  );
  const selection = validateDoorById(files, id.data);
  if (selection.kind === 'error') {
    return { kind: 'error', lines: formatErrors(selection.errors).split('\n') };
  }

  const host = createDoorAuthoringHost(selection);
  const result = await host.launch(id.data);
  if (result.kind === 'screen') return { ...result, host };
  return { kind: 'error', lines: [`Could not launch door "${id.data}".`] };
}
