import { describe, expect, it } from 'vitest';
import { archiveSchema, type Archive } from '../../src/content/schema.ts';
import { searchArchives } from '../../src/world/archive.ts';

const archive = (over: Partial<Archive> & { id: string }): Archive =>
  archiveSchema.parse({ board: 'OPS', title: 'T', from: 'F', date: 'D', body: [], ...over });

const ordinary = archive({ id: 'plain', title: 'Peer list policy', keywords: ['policy'] });
const hidden = archive({ id: 'hidden', title: 'Station log', searchOnly: true, keywords: ['417'] });
const all = [ordinary, hidden];
const ids = (query: string, from = all) => searchArchives(from, query).map((a) => a.id);

describe('archive search', () => {
  it('browses ordinary entries on an empty query, never hidden ones', () => {
    expect(ids('')).toEqual(['plain']);
    expect(ids('  ')).toEqual(['plain']);
  });

  it('finds ordinary entries by title, board, sender and keyword', () => {
    expect(ids('peer')).toEqual(['plain']);
    expect(ids('ops')).toEqual(['plain']);
    expect(ids('policy')).toEqual(['plain']);
    expect(ids('nothing here')).toEqual([]);
  });

  it('reveals hidden entries only for their exact keyword', () => {
    expect(ids('417')).toEqual(['hidden']);
    expect(ids('4-1-7')).toEqual(['hidden']);
    expect(ids('41')).toEqual([]);
    expect(ids('station')).toEqual([]);
  });

  it('cannot reveal an entry the caller has not unlocked', () => {
    expect(ids('417', [ordinary])).toEqual([]);
  });
});
