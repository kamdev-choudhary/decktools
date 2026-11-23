import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { SessionInfo } from '../../shared/types.js';
import { parse } from '../schemas.js';
import { LoginLimiter, SessionStore, safeEqual } from './sessions.js';

export interface AuthConfig {
  username: string;
  password: string;
}

const COOKIE = 'pgdeck_session';

const loginBody = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
});

function clientKey(c: Context): string {
  // Behind a proxy every request comes from the proxy; prefer the forwarded address.
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const isHttps = (c: Context) => c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';

/**
 * Cookie-session auth for the UI's own login page. With `auth === null`
 * (--no-auth) every request is let through.
 */
export function createAuth(auth: AuthConfig | null) {
  const sessions = new SessionStore();
  const limiter = new LoginLimiter();

  const currentUser = (c: Context): string | null => (auth ? sessions.touch(getCookie(c, COOKIE)) : null);

  const requireSession: MiddlewareHandler = async (c, next) => {
    if (auth && !currentUser(c)) return c.json({ error: 'Not signed in' }, 401);
    await next();
  };

  const routes = new Hono()
    .get('/session', (c) => {
      const username = currentUser(c);
      return c.json<SessionInfo>({ authRequired: !!auth, authenticated: !auth || !!username, username });
    })
    .post('/login', async (c) => {
      if (!auth) return c.json<SessionInfo>({ authRequired: false, authenticated: true, username: null });

      const key = clientKey(c);
      const wait = limiter.retryAfter(key);
      if (wait) {
        c.header('retry-after', String(wait));
        return c.json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.` }, 429);
      }

      const { username, password } = parse(loginBody, await c.req.json().catch(() => ({})));
      // Evaluate both comparisons so timing doesn't reveal which one failed.
      const userOk = safeEqual(username, auth.username);
      const passOk = safeEqual(password, auth.password);
      if (!userOk || !passOk) {
        limiter.fail(key);
        return c.json({ error: 'Incorrect username or password' }, 401);
      }

      limiter.succeed(key);
      setCookie(c, COOKIE, sessions.create(username), {
        httpOnly: true,
        sameSite: 'Strict',
        secure: isHttps(c),
        path: '/',
      });
      return c.json<SessionInfo>({ authRequired: true, authenticated: true, username });
    })
    .post('/logout', (c) => {
      sessions.revoke(getCookie(c, COOKIE));
      deleteCookie(c, COOKIE, { path: '/' });
      return c.json<SessionInfo>({ authRequired: !!auth, authenticated: !auth, username: null });
    });

  return { routes, requireSession };
}
