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
import { dirname, join, relative, resolve } from 'node:path';
import { assert, describe, expect, it } from 'vitest';
import { openDoorPreview } from '../../src/app/door-preview-session.ts';
import { evaluate } from '../../src/content/conditions.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { freshSave } from '../../src/progress/save.ts';

const { content, errors } = loadContent(readContentDir(resolve('content')));
const forge = content.artifacts.find((a) => a.id === 'forge')!;
const FORMS = [
  'propose-transmission.yml',
  'propose-archive-entry.yml',
  'propose-character.yml',
  'propose-branching-adventure.yml',
  'propose-door-game.yml',
  'propose-network-location.yml',
  'propose-mechanic-improvement.yml',
];

describe('FORGE', () => {
  it('has valid content', () => {
    expect(errors).toEqual([]);
  });

  it('stays locked until the optional discovery', () => {
    expect(evaluate(forge.requires, new Set(['completed:episode.000']))).toBe(false);
    expect(evaluate(forge.requires, new Set(['flag:service-panel-open']))).toBe(true);
  });

  it('links only to forms that exist', () => {
    const templates = forge.links.map((link) => {
      const url = new URL(link.url);
      expect(url.origin).toBe('https://github.com');
      expect(url.pathname).toBe('/supernovae/signal-lost/issues/new');
      expect(url.hash).toBe('');
      const template = url.searchParams.get('template');
      assert(template && FORMS.includes(template), `Unknown form in ${link.url}`);
      expect([...url.searchParams]).toEqual([['template', template]]);
      expect(existsSync(`.github/ISSUE_TEMPLATE/${template}`)).toBe(true);
      return template;
    });
    expect(templates.sort()).toEqual([...FORMS].sort());
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

describe('the first door guide', () => {
  function checkDoor(root: string, id: string) {
    const log = join(root, 'door-check.log');
    const fd = openSync(log, 'w');
    try {
      const { status, error } = spawnSync(
        process.execPath,
        [resolve('scripts/check-door.ts'), id],
        {
          cwd: root,
          stdio: ['ignore', fd, fd],
          timeout: 15_000,
        },
      );
      if (error) throw error;
      return { status, output: readFileSync(log, 'utf8') };
    } finally {
      closeSync(fd);
    }
  }

  function expectOnlySmoke(root: string, id: string) {
    const { status, output } = checkDoor(root, id);
    expect(status, output).toBe(0);
    expect(output.match(/(?:scripts|tests)\/[^\s]+\.(?:smoke|test)\.ts/g)).toEqual([
      'scripts/door-check.smoke.ts',
    ]);
  }

  it('copies, checks, plays and previews the documented door in a temporary tree', async () => {
    const guide = readFileSync('docs/door-authoring.md', 'utf8');
    const copy = /^cp (docs\/[^\s]+\.json) (content\/doors\/[^\s]+\.json)$/m.exec(guide);
    const json = /```json\n([\s\S]*?)```/.exec(guide)?.[1];
    const url = /<(http:\/\/localhost:5173\/[^>]+)>/.exec(guide)?.[1];
    const commands = /type `([^`]+)`.*then `([^`]+)`.*Use `([^`]+)`/.exec(guide);
    assert(copy?.[1] && copy[2] && json && url && commands);
    const [, source, destination] = copy;
    const [, inspect, end, exit] = commands;
    const edits = JSON.parse(json);
    expect(edits.id).toBe('bench-log');
    const previewUrl = new URL(url);
    expect(previewUrl.pathname).toBe('/signal-lost/door-preview');
    expect(previewUrl.searchParams.get('id')).toBe(edits.id);
    expect(guide).toContain(`npm run door:check -- ${edits.id}`);
    expect(guide).toContain(
      'No door code is fetched or loaded from outside the reviewed bundle at runtime.',
    );

    const root = mkdtempSync(join(tmpdir(), 'door-authoring-'));
    try {
      const contentDir = join(root, 'content');
      cpSync('content', contentDir, { recursive: true });
      const target = join(root, destination);
      expect(existsSync(target)).toBe(false);
      cpSync(source, target);
      const starter = JSON.parse(readFileSync(target, 'utf8'));
      const door = { ...starter, ...edits };
      expect(door.attribution).not.toEqual(starter.attribution);
      writeFileSync(target, JSON.stringify(door));
      expectOnlySmoke(root, edits.id);

      const loaded = loadContent(readContentDir(contentDir));
      expect(loaded.errors).toEqual([]);
      expect(loaded.manifest.entries).toContainEqual({
        kind: 'doors',
        file: destination,
        id: edits.id,
      });
      expect(loaded.content.doors.find(({ id }) => id === edits.id)).toMatchObject(edits);

      const save = freshSave(42);
      const host = createDoorHost(createDoorRegistry(loaded.content.doors), save, () => true);
      const first = await host.launch(edits.id);
      assert(first.kind === 'screen');
      expect(first.screen.lines).toContain('A log lies open on the workbench.');
      expect(first.screen.actions.map(({ command }) => command)).toEqual([inspect]);
      expect(host.input(inspect!)).toMatchObject({
        kind: 'screen',
        screen: {
          lines: expect.arrayContaining(['The switch passed its last test.']),
          actions: expect.arrayContaining([expect.objectContaining({ command: end })]),
        },
      });
      const ending = host.input(end!);
      expect(ending).toMatchObject({
        kind: 'screen',
        screen: { lines: expect.arrayContaining(['The bench log is filed.']) },
      });
      expect(save.flags).toContain('bench-log-filed');
      expect(save.doorState[edits.id]).toMatchObject({
        version: 1,
        payload: { endingId: 'filed' },
      });
      expect(exit).toBe('EXIT');
      expect(host.exit()).toEqual({ kind: 'exit', returnTo: 'bbs-menu' });

      const raw = Object.fromEntries(
        readdirSync(contentDir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => {
            const path = join(entry.parentPath, entry.name);
            return [`/${relative(root, path).replaceAll('\\', '/')}`, readFileSync(path, 'utf8')];
          }),
      );
      expect(raw[`/${destination}`]).toBe(readFileSync(target, 'utf8'));
      const preview = await openDoorPreview(previewUrl.search, raw);
      assert(preview.kind === 'screen');
      expect(preview.screen).toEqual(first.screen);
      preview.host.input(inspect!);
      expect(preview.host.input(end!)).toEqual(ending);
      expect(preview.host.facts().has('flag:bench-log-filed')).toBe(true);
      expect(preview.host.exit()).toEqual({ kind: 'exit', returnTo: 'bbs-menu' });
      const reloaded = await openDoorPreview(previewUrl.search, raw);
      assert(reloaded.kind === 'screen');
      expect(reloaded.screen).toEqual(first.screen);
      expect(reloaded.host.facts().has('flag:bench-log-filed')).toBe(false);

      const broken = 'content/doors/broken-bench-log.json';
      writeFileSync(
        join(root, broken),
        JSON.stringify({ ...door, id: 'broken-bench-log', startLocationId: 'missing-bench' }),
      );
      expect(loadContent(readContentDir(contentDir)).errors).toContainEqual({
        file: broken,
        field: 'startLocationId',
        message: 'unknown location "missing-bench"',
      });
      expectOnlySmoke(root, edits.id);
      expect(checkDoor(root, 'broken-bench-log')).toMatchObject({
        status: 1,
        output: expect.stringContaining(
          `${broken}: startLocationId: unknown location "missing-bench"`,
        ),
      });
      expect(checkDoor(root, 'unknown-door')).toMatchObject({
        status: 1,
        output: expect.stringContaining('unknown door "unknown-door"'),
      });
      expect(checkDoor(root, '../bench-log')).toMatchObject({
        status: 1,
        output: expect.stringContaining('Usage: npm run door:check -- <door-id>'),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);
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
