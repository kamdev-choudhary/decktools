import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePassword } from '@deck/security';

/** Credentials for a deck's own login page. */
export interface AuthConfig {
  username: string;
  password: string;
}

export interface ResolvedAuth extends AuthConfig {
  /** True when no password was supplied and a random one was generated. */
  generated: boolean;
}

/** The settings every deck's web server shares; tools extend this with their own. */
export interface ServerConfig {
  port: number;
  host: string;
  auth: ResolvedAuth | null;
  /** Prefix such as "/db" when a proxy forwards the path without stripping it ("" for none). */
  basePath: string;
  open: boolean;
  /** Directory holding the built web UI. */
  webRoot: string;
}

/** "db/" → "/db", "/" → "", "" → "". */
export function normalizeBasePath(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** Binds every interface (0.0.0.0 or ::). */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

/** The URL to print and open for a server bound to host:port. */
export function serverUrl(host: string, port: number, basePath: string): string {
  const shown = isWildcardHost(host) ? 'localhost' : host;
  return `http://${shown}:${port}${basePath}/`;
}

/**
 * Login credentials: the flag wins over the environment variable, and with
 * neither a random password is generated (and printed at startup).
 * Returns null when auth is disabled (--no-auth).
 */
export function resolveAuth(opts: { enabled: boolean; username: string; password?: string; passwordEnv?: string }): ResolvedAuth | null {
  if (!opts.enabled) return null;
  const password = opts.password ?? (opts.passwordEnv ? process.env[opts.passwordEnv] : undefined);
  return {
    username: opts.username,
    password: password ?? generatePassword(),
    generated: password === undefined,
  };
}

/**
 * The first candidate directory that exists, else the first candidate.
 * Tools use it to find their built UI next to the bundled CLI or in dist/
 * when run from source; pass URLs relative to the caller's import.meta.url.
 */
export function firstExistingDir(candidates: (string | URL)[]): string {
  const dirs = candidates.map((c) => (c instanceof URL ? fileURLToPath(c) : c));
  return dirs.find((dir) => fs.existsSync(dir)) ?? dirs[0]!;
}
