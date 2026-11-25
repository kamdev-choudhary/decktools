import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE } from '../../shared/constants';
import type { Role } from '../../shared/types';
import type { AppEnv, AuthedEnv, ServerContext } from '../context';
import { HttpError } from '../errors';
import type { Session } from '../sessions';

/** Header the UI may send to run a request against a specific connection (e.g. a running upload). */
export const CONNECTION_HEADER = 'x-s3deck-connection';

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function hasRole(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * The role a session has right now, or null if it should end (user removed or disabled).
 * Startup-admin and anonymous (--no-auth) sessions are admins.
 */
export function resolveRole(ctx: ServerContext, s: Session): Role | null {
  if (s.source === 'bootstrap' || s.source === 'anonymous') return 'admin';
  const record = ctx.users?.get(s.user);
  if (record) return record.disabled ? null : record.role;
  if (s.source === 'sso') return ctx.sso?.defaultRoleFor(s.user) ?? null;
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** State-changing API calls must carry a custom header. Browsers won't send it cross-site without CORS. */
export function csrf(): MiddlewareHandler {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header(CSRF_HEADER) !== CSRF_VALUE) {
      throw new HttpError(403, 'CSRF', `Missing ${CSRF_HEADER} header`);
    }
    await next();
  };
}

function isHttps(c: Context): boolean {
  return c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https' || new URL(c.req.url).protocol === 'https:';
}

export function setSessionCookie(c: Context, ctx: ServerContext, session: Session) {
  setCookie(c, SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isHttps(c),
    path: `${ctx.config.basePath}/`,
  });
}

export function clearSessionCookie(c: Context, ctx: ServerContext) {
  deleteCookie(c, SESSION_COOKIE, { path: `${ctx.config.basePath}/` });
}

/** Loads the session from the cookie. With auth disabled, everyone gets an anonymous session. */
export function loadSession(ctx: ServerContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let session = ctx.sessions.get(getCookie(c, SESSION_COOKIE));
    if (session) {
      const role = resolveRole(ctx, session);
      if (role) session.role = role;
      else {
        ctx.sessions.destroy(session.id);
        session = null;
      }
    }
    if (!session && !ctx.config.auth.enabled) {
      session = ctx.sessions.create('anonymous', 'anonymous', 'admin', ctx.connections.defaultId);
      setSessionCookie(c, ctx, session);
    }
    c.set('session', session);
    await next();
  };
}

export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get('session')) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in');
    await next();
  };
}

export function requireRole(min: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = c.get('session');
    if (!s) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in');
    if (!hasRole(s.role, min)) throw new HttpError(403, 'FORBIDDEN', `This needs the ${min} role`);
    await next();
  };
}

/**
 * Guards a change: blocked in --readonly mode, and needs at least `min`
 * (editors change objects; admins change buckets and their settings).
 */
export function writable(ctx: ServerContext, min: Role = 'editor'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (ctx.config.readonly) throw new HttpError(403, 'READONLY', 's3deck is running in read-only mode');
    const s = c.get('session');
    if (!s || !hasRole(s.role, min)) throw new HttpError(403, 'FORBIDDEN', `This needs the ${min} role`);
    await next();
  };
}

/** Records a change in the activity log. */
export function logActivity(
  ctx: ServerContext,
  c: Context,
  action: string,
  details: { bucket?: string | null; detail?: string | null } = {},
) {
  const session = c.get('session') as Session | null | undefined;
  const conn = (c.get('conn') as { label?: string } | undefined) ?? undefined;
  ctx.activity.record({
    user: session?.user ?? 'unknown',
    ip: clientAddress(c),
    action,
    connection: conn?.label ?? null,
    bucket: details.bucket ?? null,
    detail: details.detail ? details.detail.slice(0, 500) : null,
  });
}

/** A short description of a list of keys for the activity log. */
export function describeKeys(keys: string[]): string {
  if (keys.length <= 3) return keys.join(', ');
  return `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`;
}

/** Resolves the session's active storage connection. */
export function withConnection(ctx: ServerContext): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const session = c.get('session');
    const requested = c.req.header(CONNECTION_HEADER);
    if (requested) {
      const conn = ctx.connections.getForSession(requested, session);
      if (!conn) throw new HttpError(409, 'NO_CONNECTION', 'That connection is no longer available');
      c.set('conn', conn);
      return next();
    }
    let conn = ctx.connections.getForSession(session.activeConnectionId, session);
    if (!conn && ctx.connections.defaultId) {
      conn = ctx.connections.getForSession(ctx.connections.defaultId, session);
      if (conn) session.activeConnectionId = conn.id;
    }
    if (!conn) throw new HttpError(409, 'NO_CONNECTION', 'Connect to a storage provider first');
    c.set('conn', conn);
    await next();
  };
}

/** Client address for rate limiting. Trusts X-Forwarded-For only from a local proxy. */
export function clientAddress(c: Context): string {
  let remote = 'unknown';
  try {
    remote = getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // not running on node-server (tests)
  }
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return local && forwarded ? forwarded : remote;
}
