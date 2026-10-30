import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';

const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'docs/architecture.md',
  'docs/content-authoring.md',
  'docs/game-design.md',
  'docs/swarmos.md',
  'docs/roadmap.md',
];

describe('documentation', () => {
  it.each(DOCS)('%s exists and its relative links resolve', (doc) => {
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, 'utf8');
    for (const [, target] of text.matchAll(/\]\((?!https?:|#)([^)#]+)(#[^)]*)?\)/g)) {
      expect(existsSync(join(dirname(doc), target!)), `${doc} -> ${target}`).toBe(true);
    }
  });
});

describe('content links', () => {
  it('are all https', () => {
    const { content } = loadContent(readContentDir(resolve('content')));
    const links = content.artifacts.flatMap((artifact) => artifact.links);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(new URL(link.url).protocol).toBe('https:');
  });
});
