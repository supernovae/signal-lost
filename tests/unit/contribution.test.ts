import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/content/conditions.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';

const { content, errors } = loadContent(readContentDir(resolve('content')));
const forge = content.artifacts.find((a) => a.id === 'forge')!;
const FORMS = ['propose-transmission.yml', 'propose-archive-entry.yml'];

describe('FORGE', () => {
  it('has valid content', () => {
    expect(errors).toEqual([]);
  });

  it('stays locked until the optional discovery', () => {
    expect(evaluate(forge.requires, new Set(['completed:episode.000']))).toBe(false);
    expect(evaluate(forge.requires, new Set(['flag:service-panel-open']))).toBe(true);
  });

  it('links only to forms that exist', () => {
    const templates = forge.links
      .map((link) => new URL(link.url).searchParams.get('template'))
      .filter((template) => template !== null);
    expect(templates.sort()).toEqual([...FORMS].sort());
    for (const template of templates) {
      expect(existsSync(`.github/ISSUE_TEMPLATE/${template}`)).toBe(true);
    }
    for (const link of forge.links) {
      expect(new URL(link.url).hostname).toBe('github.com');
    }
  });
});

describe('issue forms', () => {
  it.each(FORMS)('%s needs no code and enters community intake', (form) => {
    const text = readFileSync(`.github/ISSUE_TEMPLATE/${form}`, 'utf8');
    expect(text).toContain("labels: ['swarm:community']");
    expect(text).toMatch(/No code needed/);
    expect(text).not.toMatch(/\.json|npm /);
  });
});

describe('the client', () => {
  const sourceFiles = (root: string): string[] =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));

  it('holds no GitHub credential and calls no GitHub API', () => {
    for (const file of [...sourceFiles('src'), ...sourceFiles('content')]) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/ghp_|github_pat_|gho_|api\.github\.com/);
      expect(text, file).not.toMatch(/Authorization/);
    }
  });
});

describe('community content', () => {
  it('loads as real, attributed game content', () => {
    const transmission = content.transmissions.find((t) => t.id === 'tx.first-light')!;
    const archive = content.archives.find((a) => a.id === 'community.second-line')!;
    expect(transmission.attribution?.author).toBe('SIGNAL//LOST maintainers');
    expect(archive.attribution?.handle).toBe('supernovae');
    expect(content.community[0]?.provenance).toContain('example');
  });
});

describe('the worked example', () => {
  const guide = readFileSync('docs/content-authoring.md', 'utf8');

  it('works when followed against a copy of the content', () => {
    const path = /Create `content\/([^`]+\.json)`/.exec(guide)?.[1];
    const json = /```json\n([\s\S]*?)```/.exec(guide)?.[1];
    expect(path).toBeDefined();
    expect(json).toBeDefined();

    const root = mkdtempSync(join(tmpdir(), 'authoring-'));
    try {
      const copy = join(root, 'content');
      cpSync('content', copy, { recursive: true });
      const target = join(copy, path!);
      expect(existsSync(dirname(target))).toBe(true);
      writeFileSync(target, json!);

      // Output goes through a file: stdio pipes lose data in the validation sandbox.
      const log = join(root, 'out.log');
      const fd = openSync(log, 'w');
      const { status } = spawnSync(process.execPath, ['scripts/validate-content.ts', copy], {
        stdio: ['ignore', fd, fd],
      });
      closeSync(fd);
      expect(readFileSync(log, 'utf8')).toContain('Content OK');
      expect(status).toBe(0);

      const loaded = loadContent(readContentDir(copy));
      const added = loaded.content.transmissions.find((t) => t.id === 'tx.night-shift');
      expect(added?.attribution?.handle).toBe('your-github-handle');
      const facts = new Set(['completed:episode.000']);
      expect(evaluate(added?.requires, facts)).toBe(true);
      expect(evaluate(added?.requires, new Set())).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CONTRIBUTING', () => {
  const guide = readFileSync('CONTRIBUTING.md', 'utf8');

  it('covers each way in', () => {
    expect(guide).toMatch(/## Without writing code/);
    expect(guide).toMatch(/## With code or content, without SwarmOS/);
    expect(guide).toMatch(/## With SwarmOS/);
  });

  it('links to things that exist', () => {
    for (const [, target] of guide.matchAll(/\]\((?!https?:)([^)]+)\)/g)) {
      expect(existsSync(target!), target).toBe(true);
    }
    for (const [, form] of guide.matchAll(/template=([a-z-]+\.yml)/g)) {
      expect(existsSync(`.github/ISSUE_TEMPLATE/${form}`), form).toBe(true);
    }
  });
});
