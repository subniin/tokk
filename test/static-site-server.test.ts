// Task 21 (test H1): the static server of the site E2E under /tokk/.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startSiteServer } from './helpers/static-site-server';
import type { SiteServer } from './helpers/static-site-server';

const PREFIX = '/tokk/';
const SECRET = 'outside-secret';
let parent = '';
let server: SiteServer;

function get(port: number, path: string): Promise<{ status: number; type: string; location: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'localhost', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), location: String(res.headers.location ?? ''), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'tokk-server-'));
  const root = join(parent, 'site');
  const put = (rel: string, text: string): void => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  put('index.html', '<h1>home</h1>');
  put('examples/hello/index.html', '<h1>hello</h1>');
  put('examples/hello/sounds.json', '{}');
  put('dist/a.js', 'export {};');
  put('style.css', 'a{}');
  put('empty/readme.txt', 'no index here');
  writeFileSync(join(parent, 'secret.txt'), SECRET);
  server = await startSiteServer(root, PREFIX);
});
afterAll(async () => {
  await server?.close();
  rmSync(parent, { recursive: true, force: true });
});

describe('static site server (Task 21, H1)', () => {
  it('serves files below the prefix with content types, and records every request path', async () => {
    const html = await get(server.port, `${PREFIX}index.html`);
    expect([html.status, html.type, html.body]).toEqual([200, 'text/html; charset=utf-8', '<h1>home</h1>']);
    expect((await get(server.port, `${PREFIX}dist/a.js`)).type).toBe('text/javascript; charset=utf-8');
    expect((await get(server.port, `${PREFIX}examples/hello/sounds.json`)).type).toBe('application/json');
    expect((await get(server.port, `${PREFIX}style.css`)).type).toBe('text/css; charset=utf-8');
    expect(server.requests).toContain(`${PREFIX}dist/a.js`);
    expect(server.url).toBe(`http://localhost:${server.port}`);
  });

  it('answers a folder URL with its index.html and a folder without a slash with a redirect', async () => {
    expect((await get(server.port, PREFIX)).body).toBe('<h1>home</h1>');
    expect((await get(server.port, `${PREFIX}examples/hello/`)).body).toBe('<h1>hello</h1>');
    const redirect = await get(server.port, `${PREFIX}examples/hello`);
    expect(redirect.status).toBe(301);
    expect(redirect.location).toBe(`${PREFIX}examples/hello/`);
  });

  it('answers 404 outside the prefix, at /, for a missing file and for a folder without index.html', async () => {
    expect((await get(server.port, '/favicon.ico')).status).toBe(204);   // asked for by Chrome itself, see the helper
    for (const path of ['/', '/index.html', '/dist/a.js', '/other/index.html', `${PREFIX}missing.html`, `${PREFIX}empty/`]) {
      expect((await get(server.port, path)).status, path).toBe(404);
    }
  });

  it('refuses a path that leaves the folder, after decoding', async () => {
    for (const path of [`${PREFIX}..%2fsecret.txt`, `${PREFIX}%2e%2e/secret.txt`, `${PREFIX}%2e%2e%2f%2e%2e%2fsecret.txt`, `${PREFIX}examples/..%5c..%5csecret.txt`]) {
      const r = await get(server.port, path);
      expect([400, 403, 404], path).toContain(r.status);
      expect(r.body, path).not.toContain(SECRET);
    }
  });
});
