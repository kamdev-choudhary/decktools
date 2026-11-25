import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AuthConfig } from '../server/index.js';

/** Raw options as parsed by commander. */
export interface CliOptions {
  port: number;
  host: string;
  user: string;
  password?: string;
  auth: boolean; // false when --no-auth is passed
  readonly: boolean;
  ssl: boolean;
  basePath: string;
  maxRows: number;
  open: boolean;
}

export interface AppConfig {
  connectionString: string;
  port: number;
  host: string;
  auth: (AuthConfig & { generated: boolean }) | null;
  readonly: boolean;
  ssl: boolean;
  basePath: string;
  maxRows: number;
  open: boolean;
  webRoot: string;
}

export function normalizeBasePath(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Locate the built UI: next to the bundled CLI in dist/, or dist/web when run from source. */
function resolveWebRoot(): string {
  const candidates = [new URL('./web', import.meta.url), new URL('../../dist/web', import.meta.url)].map((u) => fileURLToPath(u));
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0]!;
}

export function resolveConfig(connectionArg: string | undefined, opts: CliOptions): AppConfig {
  const envPassword = process.env.PGDECK_PASSWORD;
  const password = opts.password ?? envPassword;

  return {
    connectionString: connectionArg ?? process.env.DATABASE_URL ?? '',
    port: opts.port,
    host: opts.host,
    auth: opts.auth
      ? {
          username: opts.user,
          password: password ?? crypto.randomBytes(9).toString('base64url'),
          generated: password === undefined,
        }
      : null,
    readonly: opts.readonly,
    ssl: opts.ssl,
    basePath: normalizeBasePath(opts.basePath),
    maxRows: opts.maxRows,
    open: opts.open,
    webRoot: resolveWebRoot(),
  };
}

/** Hide the password in a connection string before printing it. */
export function redact(connectionString: string): string {
  if (!connectionString) return '(PG* environment defaults)';
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '****';
    return url.toString();
  } catch {
    return connectionString.replace(/password=\S+/i, 'password=****');
  }
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
