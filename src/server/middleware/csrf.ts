import type { MiddlewareHandler } from 'hono';

export const CSRF_HEADER = 'x-pgdeck';

/**
 * Require a custom header on API calls. A browser cannot attach one to a
 * cross-origin request without a CORS preflight, which this server never
 * approves, so other sites can't ride on the cached Basic-auth credentials.
 */
export const requireCsrfHeader: MiddlewareHandler = async (c, next) => {
  // Exports are plain GET downloads (<a href download>), which can't send headers.
  // They're read-only, and the SameSite=Strict session cookie isn't sent on
  // cross-site navigations, so other sites still can't trigger them as you.
  const isExport = c.req.method === 'GET' && /^\/api\/db\/[^/]+\/export$/.test(c.req.path);
  if (!isExport && c.req.header(CSRF_HEADER) !== '1') {
    return c.json({ error: `Missing ${CSRF_HEADER} header` }, 403);
  }
  await next();
};
