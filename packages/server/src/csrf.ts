import type { Context, MiddlewareHandler } from 'hono';

export interface CsrfOptions {
  /** Header the UI sends with value "1" on every API call, e.g. "x-pgdeck". */
  header: string;
  /** Requests that may skip the check, such as plain GET downloads. */
  exempt?: (c: Context) => boolean;
}

/**
 * Require a custom header on API calls. A browser cannot attach one to a
 * cross-origin request without a CORS preflight, which a deck never
 * approves, so other sites can't make requests that ride on the session cookie.
 *
 * Only exempt read-only GETs: they still can't be triggered cross-site as the
 * user, because the SameSite=Strict session cookie isn't sent on cross-site
 * navigations.
 */
export function requireCsrfHeader({ header, exempt }: CsrfOptions): MiddlewareHandler {
  return async (c, next) => {
    if (!exempt?.(c) && c.req.header(header) !== '1') {
      return c.json({ error: `Missing ${header} header` }, 403);
    }
    await next();
  };
}
