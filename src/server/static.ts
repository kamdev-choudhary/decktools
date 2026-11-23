import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // CodeMirror injects style tags
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
].join('; ');

interface Asset {
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

export function serveAssets(assets: Map<string, Asset> | null): MiddlewareHandler {
  return async (c) => {
    if (!assets) {
      return c.text('pgdeck UI is not built. Run "npm run build", or use "npm run dev" during development.', 503);
    }
    const p = c.req.path === '/' ? '/index.html' : c.req.path;
    const asset = assets.get(p);
    if (!asset) return c.json({ error: 'Not found' }, 404);

    c.header('content-type', asset.type);
    c.header('x-content-type-options', 'nosniff');
    if (p === '/index.html') {
      c.header('cache-control', 'no-store');
      c.header('content-security-policy', CSP);
      c.header('referrer-policy', 'no-referrer');
    } else if (p.startsWith('/assets/')) {
      c.header('cache-control', 'public, max-age=31536000, immutable'); // content-hashed by Vite
    }
    return c.body(asset.body);
  };
}
