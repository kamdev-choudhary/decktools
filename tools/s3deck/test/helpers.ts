import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app';
import { ConnectionRegistry } from '../src/server/connections';
import type { ServerContext } from '../src/server/context';
import { JobRegistry } from '../src/server/jobs';
import { RateLimiter } from '../src/server/middleware/rate-limit';
import { SessionStore } from '../src/server/sessions';
import { ActivityLog } from '../src/server/store/activity';
import { loadSecretKey } from '../src/server/store/crypto';
import { SavedConnectionStore } from '../src/server/store/saved-connections';
import { UserStore } from '../src/server/store/users';
import { ZipTokens } from '../src/server/zip-tokens';

export const ADMIN = { username: 'admin', password: 'admin-password-1' };

/** An s3deck app with a temp data directory and no storage connection, for request-level tests. */
export async function testApp(overrides: { readonly?: boolean; auth?: boolean } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 's3deck-app-'));
  const key = await loadSecretKey(dataDir, 'test');
  const users = new UserStore(dataDir);
  await users.load();
  const saved = new SavedConnectionStore(dataDir, key);
  const ctx: ServerContext = {
    config: {
      host: '127.0.0.1',
      port: 0,
      basePath: '',
      auth: { enabled: overrides.auth ?? true, user: ADMIN.username, password: ADMIN.password },
      readonly: overrides.readonly ?? false,
      version: 'test',
      webRoot: null,
      allowBrowserConnections: true,
      dataDir,
      publicUrl: null,
      dev: false,
    },
    sessions: new SessionStore(),
    connections: new ConnectionRegistry(),
    zipTokens: new ZipTokens(),
    loginLimiter: new RateLimiter(5, 60_000),
    users,
    saved,
    activity: new ActivityLog(null),
    jobs: new JobRegistry(),
    sso: null,
  };
  const app = createApp(ctx);
  return { app, ctx };
}

/** A tiny cookie-keeping client for app.request(). */
export function client(app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> }) {
  let cookie = '';
  const call = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
    raw?: string | Uint8Array,
  ) => {
    const res = await app.request(`http://localhost${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(raw !== undefined
          ? {
              'content-type': 'application/octet-stream',
              'content-length': String(typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength),
            }
          : {}),
        ...(method !== 'GET' ? { 'x-s3deck-csrf': '1' } : {}),
        ...headers,
      },
      body:
        raw !== undefined
          ? (raw as unknown as RequestInit['body'])
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0] ?? '';
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
  return {
    get: (url: string, headers?: Record<string, string>) => call('GET', url, undefined, headers),
    post: (url: string, body?: unknown, headers?: Record<string, string>) => call('POST', url, body ?? {}, headers),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    put: (url: string, body: unknown) => call('PUT', url, body),
    /** PUT raw bytes (uploads and multipart parts). */
    putRaw: (url: string, raw: string | Uint8Array) => call('PUT', url, undefined, {}, raw),
    del: (url: string) => call('DELETE', url),
    login: (username: string, password: string) => call('POST', '/api/auth/login', { username, password }),
  };
}
