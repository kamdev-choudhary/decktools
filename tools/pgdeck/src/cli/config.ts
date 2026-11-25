import type { ServerCliOptions } from '@deck/cli';
import { firstExistingDir, normalizeBasePath, resolveAuth, type ServerConfig } from '@deck/config';
import { redactCredentials } from '@deck/security';

/** Raw options as parsed by commander. */
export interface CliOptions extends ServerCliOptions {
  readonly: boolean;
  ssl: boolean;
  maxRows: number;
}

export interface AppConfig extends ServerConfig {
  connectionString: string;
  readonly: boolean;
  ssl: boolean;
  maxRows: number;
}

/** Locate the built UI: next to the bundled CLI in dist/, or dist/web when run from source. */
const resolveWebRoot = () =>
  firstExistingDir([new URL('./web', import.meta.url), new URL('../../dist/web', import.meta.url)]);

export function resolveConfig(connectionArg: string | undefined, opts: CliOptions): AppConfig {
  return {
    connectionString: connectionArg ?? process.env.DATABASE_URL ?? '',
    port: opts.port,
    host: opts.host,
    auth: resolveAuth({
      enabled: opts.auth,
      username: opts.user,
      password: opts.password,
      passwordEnv: 'PGDECK_PASSWORD',
    }),
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
  return redactCredentials(connectionString);
}
