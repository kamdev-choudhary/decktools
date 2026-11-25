import type { Context } from 'hono';
import { ReplyError } from 'ioredis';
import { createDeckApp } from '@deck/server';
import type { AuthConfig } from '@deck/config';
import { UserError, type RedisManager } from '../redis/index.js';
import type { ApiErrorBody } from '../shared/types.js';
import { apiRoutes } from './routes.js';

export type { AuthConfig } from '@deck/config';

/** Session cookie, CSRF header: part of the contract with the UI and open browsers. */
export const SESSION_COOKIE = 'redisdeck_session';
export const CSRF_HEADER = 'x-redisdeck';

export interface AppOptions {
  manager: RedisManager;
  auth: AuthConfig | null;
  basePath: string;
  webRoot: string;
}

export function mapError(err: Error, c: Context): Response | undefined {
  if (err instanceof UserError) return c.json<ApiErrorBody>({ error: err.message }, err.status);
  // Errors Redis itself replied with (WRONGTYPE, syntax, NOPERM...) are the user's to fix.
  if (err instanceof ReplyError) return c.json<ApiErrorBody>({ error: err.message }, 400);
  // Connection trouble: Redis down, restarting, or unreachable.
  if (/Connection is closed|ECONNREFUSED|ETIMEDOUT|max retries per request|Stream isn't writeable/i.test(err.message)) {
    return c.json<ApiErrorBody>({ error: `Can't reach Redis: ${err.message}` }, 502);
  }
  return undefined;
}

export function createApp({ manager, auth, basePath, webRoot }: AppOptions) {
  return createDeckApp({
    name: 'redisdeck',
    auth,
    basePath,
    webRoot,
    cookieName: SESSION_COOKIE,
    csrf: { header: CSRF_HEADER },
    api: apiRoutes(manager),
    mapError,
  });
}
