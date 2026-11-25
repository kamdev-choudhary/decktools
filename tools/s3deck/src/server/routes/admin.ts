import { Hono } from 'hono';
import { z } from 'zod';
import { activityQuerySchema, createUserSchema, updateUserSchema, usernameSchema } from '../../shared/schemas';
import type { UserInfo } from '../../shared/types';
import type { AuthedEnv, ServerContext } from '../context';
import { HttpError } from '../errors';
import { logActivity, requireRole } from '../middleware';
import type { UserRecord } from '../store/users';
import { validate } from '../validate';

const toInfo = (u: UserRecord): UserInfo => ({
  username: u.username,
  role: u.role,
  disabled: u.disabled,
  hasPassword: !!u.passwordHash,
  createdAt: u.createdAt,
});

/** User management and the activity log. Admins only. */
export function adminRoutes(ctx: ServerContext) {
  const usersOrFail = () => {
    if (!ctx.users)
      throw new HttpError(400, 'NO_PERSISTENCE', 'This server has no data directory, so users can’t be stored');
    return ctx.users;
  };
  const userParam = z.object({ username: usernameSchema });

  return new Hono<AuthedEnv>()
    .use(requireRole('admin') as never)

    .get('/users', (c) => c.json({ users: (ctx.users?.list() ?? []).map(toInfo), startupAdmin: ctx.config.auth.user }))

    .post('/users', validate('json', createUserSchema), async (c) => {
      const users = usersOrFail();
      const input = c.req.valid('json');
      if (users.get(input.username) || input.username.toLowerCase() === ctx.config.auth.user.toLowerCase()) {
        throw new HttpError(409, 'EXISTS', 'A user with that name already exists');
      }
      if (!input.password && !input.username.includes('@')) {
        throw new HttpError(
          400,
          'VALIDATION',
          'Without a password, the username must be the email used for single sign-on',
        );
      }
      const record = await users.create(input);
      logActivity(ctx, c, 'user.create', { detail: `${record.username} (${record.role})` });
      return c.json(toInfo(record), 201);
    })

    .patch('/users/:username', validate('param', userParam), validate('json', updateUserSchema), async (c) => {
      const users = usersOrFail();
      const { username } = c.req.valid('param');
      const patch = c.req.valid('json');
      const me = c.get('session');
      if (
        me.user.toLowerCase() === username.toLowerCase() &&
        (patch.disabled || (patch.role && patch.role !== 'admin'))
      ) {
        throw new HttpError(400, 'NOT_ALLOWED', 'You can’t disable yourself or remove your own admin role');
      }
      const record = await users.update(username, patch);
      if (!record) throw new HttpError(404, 'NOT_FOUND', 'User not found');
      const what = [
        patch.role && `role ${patch.role}`,
        patch.disabled !== undefined && (patch.disabled ? 'disabled' : 'enabled'),
        patch.password && 'password reset',
      ]
        .filter(Boolean)
        .join(', ');
      logActivity(ctx, c, 'user.update', { detail: `${record.username}: ${what}` });
      return c.json(toInfo(record));
    })

    .delete('/users/:username', validate('param', userParam), async (c) => {
      const users = usersOrFail();
      const { username } = c.req.valid('param');
      if (c.get('session').user.toLowerCase() === username.toLowerCase()) {
        throw new HttpError(400, 'NOT_ALLOWED', 'You can’t delete yourself');
      }
      if (!(await users.remove(username))) throw new HttpError(404, 'NOT_FOUND', 'User not found');
      logActivity(ctx, c, 'user.delete', { detail: username });
      return c.json({ ok: true });
    })

    .get('/activity', validate('query', activityQuerySchema), (c) => {
      const q = c.req.valid('query');
      return c.json({ entries: ctx.activity.list(q), persisted: !!ctx.config.dataDir });
    });
}
