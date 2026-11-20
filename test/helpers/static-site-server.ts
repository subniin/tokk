// A tiny static server for the site E2E (Task 21, requirement 12.1). It serves files below `prefix` only and answers 404
// for every other path, so a root-absolute URL in the site fails a test. It reads files and sends nothing off the machine.

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { DEV_SERVER_HOST } from '../../scripts/build';

export const FAVICON_PATH = '/favicon.ico';

export interface SiteServer { url: string; port: number; requests: string[]; close(): Promise<void> }

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
};

export async function startSiteServer(rootDir: string, prefix: string): Promise<SiteServer> {
  const root = resolve(rootDir);
  const requests: string[] = [];
  const send = (res: import('node:http').ServerResponse, status: number, body: string | Buffer = '', headers: Record<string, string> = {}): void => {
    res.writeHead(status, headers);
    res.end(body);
  };
  const server: Server = createServer((req, res) => {
    const rawPath = (req.url ?? '/').split('?')[0].split('#')[0];
    requests.push(rawPath);
    let decoded: string;
    try { decoded = decodeURIComponent(rawPath); } catch { return send(res, 400, 'bad path'); }
    if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..')) return send(res, 400, 'bad path');
    // Chrome asks for this by itself, and no page links it. esbuild's dev server answers it too, so it is not a failure of the site.
    if (decoded === FAVICON_PATH) return send(res, 204);
    if (decoded === prefix.replace(/\/$/, '')) return send(res, 301, '', { Location: prefix });
    if (!decoded.startsWith(prefix)) return send(res, 404, 'not found');
    const target = resolve(join(root, decoded.slice(prefix.length)));
    if (target !== root && !target.startsWith(root + sep)) return send(res, 400, 'bad path');
    if (!existsSync(target)) return send(res, 404, 'not found');
    if (statSync(target).isDirectory()) {
      if (!decoded.endsWith('/')) return send(res, 301, '', { Location: `${rawPath}/` });
      const index = join(target, 'index.html');
      if (!existsSync(index)) return send(res, 404, 'not found');
      return send(res, 200, readFileSync(index), { 'Content-Type': CONTENT_TYPES['.html'] });
    }
    return send(res, 200, readFileSync(target), { 'Content-Type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' });
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, DEV_SERVER_HOST, () => ok());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The static server has no port.');
  return {
    url: `http://${DEV_SERVER_HOST}:${address.port}`,
    port: address.port,
    requests,
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
