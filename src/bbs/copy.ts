import copy from '../../content/bbs/interface.json' with { type: 'json' };
import type { Archive, BbsRecord } from '../content/schema.ts';

export const bbsCopy = copy satisfies Omit<Extract<BbsRecord, { kind: 'interface' }>, 'kind'>;

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (placeholder: string, key: string) =>
    Object.hasOwn(values, key) ? values[key]! : placeholder,
  );
}

export function messageCredit(attribution: Archive['attribution']): string | undefined {
  if (!attribution) return;
  const { author, handle } = attribution;
  return fill(bbsCopy.text.credit, { name: handle ? `${author} (${handle})` : author });
}
