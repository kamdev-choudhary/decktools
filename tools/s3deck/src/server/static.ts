import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';
import mime from 'mime-types';

/** Serves the built UI. Hashed assets are cached forever; index.html never is. */
export function createStaticHandler(webRoot: string) {
  const root = path.resolve(webRoot);
  // Read on each request (it's tiny), so a rebuild never serves stale asset hashes.
  const index = (c: Context) => {
    return readFile(path.join(root, 'index.html'), 'utf8').then(
      (html) => {
        c.header('Cache-Control', 'no-cache');
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Referrer-Policy', 'no-referrer');
        c.header('X-Frame-Options', 'DENY');
        c.header(
          'Content-Security-Policy',
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
            "frame-src 'self' blob:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
        );
        return c.html(html);
      },
      () => c.text('The web UI is not built. Run "pnpm build".', 500),
    );
  };

  return async (c: Context, relPath: string) => {
    if (relPath === '' || relPath === 'index.html') return index(c);

    const file = path.resolve(root, relPath);
    if (!file.startsWith(root + path.sep)) return c.notFound();
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      const data = await readFile(file);
      c.header('Content-Type', mime.contentType(path.extname(file)) || 'application/octet-stream');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Cache-Control', relPath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return c.body(data);
    } catch {
      // Unknown paths get the app, so reloads and bookmarks work.
      return relPath.startsWith('assets/') ? c.notFound() : index(c);
    }
  };
}
