import { readFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { assert, describe, expect, it, vi } from 'vitest';
import { openDoorPreview } from '../../src/app/door-preview-session.ts';
import { parseContentJson, validateDoorById } from '../../src/content/validate.ts';
import { createDoorAuthoringHost } from '../../src/doors/authoring.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { freshSave } from '../../src/progress/save.ts';
import tinyAdventure from '../fixtures/tiny-adventure.json';

function request(server: ViteDevServer, method: string, url: string): Promise<string | undefined> {
  // Connect middleware can handle HTTP messages without opening a listening socket.
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method;
  incoming.url = url;
  incoming.headers.host = 'localhost:5173';
  const response = new ServerResponse(incoming);
  return new Promise((resolve, reject) => {
    response.end = (body?: unknown) => {
      resolve(typeof body === 'string' ? body : undefined);
      return response;
    };
    server.middlewares(incoming, response, (error?: unknown) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

describe('the Vite door preview route', () => {
  it.each(['/signal-lost/', '/', '/custom/game/'])(
    'uses the exact route at base %s',
    async (base) => {
      const server = await createServer({
        base,
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, watch: null, ws: false },
      });
      try {
        expect(server.config.plugins.map(({ name }) => name)).toContain('signal-lost-door-preview');
        const transform = vi.spyOn(server, 'transformIndexHtml');
        const route = `${base}door-preview`;
        const url = `${route}?id=bench-log&sample=1`;
        const html = await request(server, 'GET', url);
        expect(transform).toHaveBeenCalledWith(url, expect.stringContaining('Door preview'));
        expect(html).toContain(`src="${base}src/app/door-preview.ts"`);
        for (const [method, path] of [
          ['GET', base],
          ['GET', `${route}/?id=bench-log`],
          ['GET', `${route}-other`],
          ['POST', url],
        ] as const) {
          expect(await request(server, method, path)).toBeUndefined();
        }
        if (base !== '/') {
          expect(await request(server, 'GET', '/door-preview?id=bench-log')).toBeUndefined();
        }
        expect(transform).toHaveBeenCalledTimes(1);

        const entry = await server.transformRequest('/src/app/door-preview.ts');
        expect(entry?.code).toContain('"/content/doors/forgotten-archive.json":');
        expect(entry?.code).toMatch(/\/content\/doors\/forgotten-archive\.json\?[^"']*\braw\b/);
      } finally {
        await server.close();
      }
    },
    15_000,
  );
});

const path = '/content/doors/bench-log.json';
const episodePath = '/content/episodes/episode-000.json';
const door = { ...tinyAdventure, id: 'bench-log' };
const raw = {
  [path]: JSON.stringify(door),
  [episodePath]: readFileSync(episodePath.slice(1), 'utf8'),
};

describe('opening a door preview', () => {
  it('launches a gated door without changing its normal admission', async () => {
    const selection = validateDoorById(
      {
        [path.slice(1)]: parseContentJson(raw[path]),
        [episodePath.slice(1)]: parseContentJson(raw[episodePath]),
      },
      'bench-log',
    );
    assert(selection.kind === 'declarative');
    const registry = createDoorRegistry([selection.door], []);
    const host = createDoorHost(registry, freshSave(42), () => true);
    expect(await host.launch('bench-log')).toEqual({ kind: 'unavailable' });

    const authored = await createDoorAuthoringHost(selection).launch('bench-log');
    expect(authored.kind).toBe('screen');
    expect(selection.door.requires).toBe('completed:episode.000');
    const preview = await openDoorPreview('?id=bench-log', raw);
    assert(preview.kind === 'screen');
    expect(preview.screen.lines).toContain('Steps lead down to a workbench.');
    expect(preview.screen.actions).toEqual([{ command: 'DOWN', label: 'Go down' }]);
    const admitted = freshSave(42);
    admitted.episodes.push('episode.000');
    expect(await createDoorHost(registry, admitted, () => true).launch('bench-log')).toEqual({
      kind: 'screen',
      screen: preview.screen,
    });
  });

  it.each(['', '?id=', '?id=BAD%20ID', '?id=bench-log&id=bench-log'])(
    'explains how to supply exactly one valid ID for %j',
    async (query) => {
      expect(await openDoorPreview(query, raw)).toEqual({
        kind: 'error',
        lines: ['Supply exactly one valid door ID with ?id=<door-id>.'],
      });
    },
  );

  it('names an unknown door', async () => {
    expect(await openDoorPreview('?id=unknown-door', raw)).toEqual({
      kind: 'error',
      lines: ['content/doors: id: unknown door "unknown-door"'],
    });
  });

  it('reports a selected door reference error with file and field', async () => {
    expect(
      await openDoorPreview('?id=bench-log', {
        ...raw,
        [path]: JSON.stringify({ ...door, startLocationId: 'missing-bench' }),
      }),
    ).toEqual({
      kind: 'error',
      lines: ['content/doors/bench-log.json: startLocationId: unknown location "missing-bench"'],
    });
  });

  it('reports a selected JSON parse failure with file and field', async () => {
    expect(await openDoorPreview('?id=bench-log', { ...raw, [path]: '{' })).toEqual({
      kind: 'error',
      lines: [expect.stringContaining('content/doors/bench-log.json: (file): invalid JSON:')],
    });
  });

  it('opens the same screen when another file contains malformed JSON', async () => {
    const expected = await openDoorPreview('?id=bench-log', raw);
    const preview = await openDoorPreview('?id=bench-log', {
      ...raw,
      '/content/doors/unrelated.json': '{',
    });
    assert(expected.kind === 'screen' && preview.kind === 'screen');
    expect(preview.screen).toEqual(expected.screen);
  });
});
