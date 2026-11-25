import type { RepairManifest } from '../content/repair-manifest.ts';
import type { BbsMessage, ReconstructionCheck } from '../content/schema.ts';

type Evidence = Pick<BbsMessage, 'body' | 'retainedModule' | 'sealedOriginals' | 'dispatchCopy'>;
type FindEvidence = (id: string) => Evidence | undefined;
type Problem = { field: string; message: string };

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Verifies the retained fragments independently of the Annex's read checklist. */
export function compareReconstruction(
  check: ReconstructionCheck,
  manifest: RepairManifest,
  find: FindEvidence,
) {
  const fragments = check.fragmentMessageIds.map((id) => find(id)?.retainedModule);
  const { modules } = manifest;
  if (fragments.length !== modules.length || fragments.some((fragment) => !fragment)) {
    return { problem: { field: 'fragmentMessageIds', message: 'expected every signed module' } };
  }
  const byName = new Map(fragments.map((fragment) => [fragment!.name, fragment!]));
  if (
    byName.size !== modules.length ||
    new Set(modules.map(({ name }) => name)).size !== modules.length
  ) {
    return {
      problem: {
        field: 'fragmentMessageIds',
        message: 'module names must be unique and agree with the manifest',
      },
    };
  }
  const verified: NonNullable<Evidence['retainedModule']>[] = [];
  const seals = new Set<string>();
  for (const spec of modules) {
    const fragment = byName.get(spec.name);
    if (
      !fragment ||
      fragment.seal !== spec.seal ||
      fragment.boundary !== 'complete' ||
      !sameOrder(fragment.dependencies, spec.dependencies)
    ) {
      return {
        problem: {
          field: 'fragmentMessageIds',
          message: `module ${spec.name} does not match its signed specification`,
        },
      };
    }
    if (
      seals.has(spec.seal) ||
      spec.dependencies.some((seal) => !seals.has(seal)) ||
      new Set(spec.dependencies).size !== spec.dependencies.length
    ) {
      return {
        problem: {
          field: 'recipe',
          message: `module ${spec.name} has a repeated seal or invalid dependency order`,
        },
      };
    }
    seals.add(spec.seal);
    verified.push(fragment);
  }
  if (!sameOrder(check.recipe, [...seals])) {
    return {
      problem: { field: 'recipe', message: 'recipe order differs from the signed build order' },
    };
  }
  return { fragments: verified };
}

/** Builds separate ordered dispatch records and verifies each against its read-only original. */
export function reconstructReplay(check: ReconstructionCheck, find: FindEvidence) {
  const fail = (field: string, message: string): { problem: Problem } => ({
    problem: { field: `custody.${field}`, message },
  });
  const { originalsMessageId, dispatchMessageIds, holdReceiptMessageId } = check.custody;
  const custody = find(originalsMessageId);
  const originals = custody?.sealedOriginals ?? [];
  const byId = new Map(originals.map((original) => [original.recordId, original]));
  if (
    originals.length !== dispatchMessageIds.length ||
    byId.size !== originals.length ||
    new Set(originals.map(({ seal }) => seal)).size !== originals.length ||
    originals.some(({ readOnly, note }) => !readOnly || !custody?.body.includes(note))
  ) {
    return fail(
      'originalsMessageId',
      'expected a unique read-only original for each dispatch copy',
    );
  }
  const replay = [];
  const deliveryIndexes = new Set<number>();
  for (const [index, id] of dispatchMessageIds.entries()) {
    const message = find(id);
    const copy = message?.dispatchCopy;
    const original = copy && byId.get(copy.recordId);
    if (
      !copy ||
      !original ||
      copy.seal !== original.seal ||
      deliveryIndexes.has(copy.deliveryIndex)
    ) {
      return fail(
        `dispatchMessageIds.${index}`,
        'dispatch copy must have a unique delivery index and match its original seal',
      );
    }
    byId.delete(copy.recordId);
    deliveryIndexes.add(copy.deliveryIndex);
    replay.push({
      ...copy,
      body: [...message.body],
      originalSeal: original.seal,
      sender: original.sender,
      note: original.note,
    });
  }
  const hold = find(holdReceiptMessageId);
  if (
    !hold ||
    holdReceiptMessageId === originalsMessageId ||
    dispatchMessageIds.includes(holdReceiptMessageId)
  ) {
    return fail('holdReceiptMessageId', 'expected a separate custody hold receipt');
  }
  return {
    replay: replay.sort((left, right) => left.deliveryIndex - right.deliveryIndex),
    hold: hold.body,
  };
}
