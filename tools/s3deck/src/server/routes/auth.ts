import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../../shared/constants';
import { loginSchema } from '../../shared/schemas';
import type { MeResponse } from '../../shared/types';
import type { AppEnv, ServerContext } from '../context';
import { HttpError } from '../errors';
import { clearSessionCookie, clientAddress, hasRole, logActivity, setSessionCookie } from '../middleware';
import type { AuthSource } from '../sessions';
import { verifyPassword } from '../store/users';
import { validate } from '../validate';
import type { Role } from '../../shared/types';

/** Constant-time string comparison (hashing first so lengths don't leak). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** The public origin + base path, for SSO redirect URLs. */
export function publicBase(c: Context, ctx: ServerContext): string {
  if (ctx.config.publicUrl) return ctx.config.publicUrl.replace(/\/+$/, '');
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || c.req.header('host') || url.host;
  return `${proto}://${host}${ctx.config.basePath}`;
}

export function authRoutes(ctx: ServerContext) {
  const { config } = ctx;

  const startSession = (c: Context, user: string, source: AuthSource, role: Role) => {
    const previous = getCookie(c, SESSION_COOKIE);
    if (previous) ctx.sessions.destroy(previous); // rotate
    const session = ctx.sessions.create(user, source, role, ctx.connections.defaultId);
    setSessionCookie(c, ctx, session);
    c.set('session', session);
    return session;
  };

  return new Hono<AppEnv>()
    .get('/me', (c) => {
      const session = c.get('session');
      const role = session?.role ?? null;
      const body: MeResponse = {
        authenticated: !!session,
        authRequired: config.auth.enabled,
        user: session?.user ?? null,
        readonly: config.readonly,
        browserConnections: config.allowBrowserConnections,
        version: config.version,
        role,
        can: {
          write: !!role && !config.readonly && hasRole(role, 'editor'),
          admin: !!role && hasRole(role, 'admin'),
        },
        sso: { enabled: !!ctx.sso, label: ctx.sso?.config.label ?? '' },
        persistence: !!ctx.saved,
      };
      return c.json(body);
    })

    .post('/login', validate('json', loginSchema), async (c) => {
      if (!config.auth.enabled) return c.json({ ok: true });

      const ip = clientAddress(c);
      const wait = ctx.loginLimiter.retryAfter(ip);
      if (wait > 0) {
        c.header('Retry-After', String(wait));
        throw new HttpError(429, 'RATE_LIMITED', `Too many failed logins. Try again in ${Math.ceil(wait / 60)} min.`);
      }

      const { username, password } = c.req.valid('json');
      // The startup admin: evaluate both comparisons so timing doesn't reveal which was wrong.
      const userOk = safeEqual(username, config.auth.user);
      const passOk = safeEqual(password, config.auth.password);
      if (userOk && passOk) {
        ctx.loginLimiter.reset(ip);
        startSession(c, username, 'bootstrap', 'admin');
        logActivity(ctx, c, 'login');
        return c.json({ ok: true });
      }

      // Users from users.json.
      const record = ctx.users?.get(username);
      if (record && !record.disabled && (await verifyPassword(password, record.passwordHash))) {
        ctx.loginLimiter.reset(ip);
        startSession(c, record.username, 'local', record.role);
        logActivity(ctx, c, 'login');
        return c.json({ ok: true });
      }

      ctx.loginLimiter.hit(ip);
      ctx.activity.record({ user: username, ip, action: 'login.failed', connection: null, bucket: null, detail: null });
      throw new HttpError(401, 'BAD_CREDENTIALS', 'Wrong username or password');
    })

    .post('/logout', (c) => {
      const session = c.get('session');
      if (session) ctx.sessions.destroy(session.id);
      clearSessionCookie(c, ctx);
      return c.json({ ok: true });
    })

    /** Single sign-on: redirect to the identity provider. */
    .get('/sso/start', async (c) => {
      if (!ctx.sso) throw new HttpError(404, 'NOT_FOUND', 'Single sign-on is not configured');
      const url = await ctx.sso.authorizationUrl(`${publicBase(c, ctx)}/api/auth/sso/callback`);
      return c.redirect(url, 302);
    })

    /** Single sign-on: back from the identity provider. */
    .get('/sso/callback', async (c) => {
      if (!ctx.sso) throw new HttpError(404, 'NOT_FOUND', 'Single sign-on is not configured');
      const home = `${config.basePath}/`;
      const fail = (message: string) => c.redirect(`${home}?login_error=${encodeURIComponent(message)}`, 302);
      try {
        const callbackUrl = new URL(`${publicBase(c, ctx)}/api/auth/sso/callback${new URL(c.req.url).search}`);
        const { email } = await ctx.sso.finish(callbackUrl);
        const record = ctx.users?.get(email);
        const role = record ? (record.disabled ? null : record.role) : ctx.sso.defaultRoleFor(email);
        if (!role) {
          ctx.activity.record({ user: email, ip: clientAddress(c), action: 'login.denied', connection: null, bucket: null, detail: 'sso' });
          return fail(`${email} is not allowed to use this s3deck.`);
        }
        startSession(c, record?.username ?? email, 'sso', role);
        logActivity(ctx, c, 'login', { detail: 'sso' });
        return c.redirect(home, 302);
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Sign-in failed');
      }
    });
}
