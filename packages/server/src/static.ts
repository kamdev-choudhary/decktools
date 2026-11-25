import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { contentSecurityPolicy } from '@deck/security';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

export interface Asset {
  body: Uint8Array<ArrayBuffer>;
  type: string;
}

/** Load the built UI into memory. It is small, and this avoids any path traversal surface. */
export function loadAssets(root: string): Map<string, Asset> | null {
  if (!fs.existsSync(path.join(root, 'index.html'))) return null;
  const assets = new Map<string, Asset>();
  for (const rel of fs.readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const abs = path.join(root, rel);
    if (!fs.statSync(abs).isFile()) continue;
    assets.set('/' + rel.split(path.sep).join('/'), {
      body: new Uint8Array(fs.readFileSync(abs)),
      type: MIME[path.extname(rel)] ?? 'application/octet-stream',
    });
  }
  return assets;
}

export interface ServeAssetsOptions {
  /** Tool name for the "not built" message. */
  name: string;
  /** Content-Security-Policy for index.html (default: contentSecurityPolicy()). */
  csp?: string;
}

export function serveAssets(assets: Map<string, Asset> | null, { name, csp = contentSecurityPolicy() }: ServeAssetsOptions): MiddlewareHandler {
  return async (c) => {
    if (!assets) {
      return c.text(`${name} UI is not built. Run "pnpm build", or use "pnpm dev" during development.`, 503);
    }
    const p = c.req.path === '/' ? '/index.html' : c.req.path;
    const asset = assets.get(p);
    if (!asset) return c.json({ error: 'Not found' }, 404);

    c.header('content-type', asset.type);
    c.header('x-content-type-options', 'nosniff');
    if (p === '/index.html') {
      c.header('cache-control', 'no-store');
      c.header('content-security-policy', csp);
      c.header('referrer-policy', 'no-referrer');
    } else if (p.startsWith('/assets/')) {
      c.header('cache-control', 'public, max-age=31536000, immutable'); // content-hashed by Vite
    }
    return c.body(asset.body);
  };
}
