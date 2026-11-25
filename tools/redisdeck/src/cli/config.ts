import type { ServerCliOptions } from '@deck/cli';
import { firstExistingDir, normalizeBasePath, resolveAuth, type ServerConfig } from '@deck/config';
import { redactCredentials } from '@deck/security';

export interface CliOptions extends ServerCliOptions {
  readonly: boolean;
  tlsInsecure: boolean;
}

export interface AppConfig extends ServerConfig {
  url: string;
  readonly: boolean;
  tlsInsecure: boolean;
}

/** The built UI: next to the bundled CLI in dist/, or dist/web when run from source. */
const resolveWebRoot = () =>
  firstExistingDir([new URL('./web', import.meta.url), new URL('../../dist/web', import.meta.url)]);

export function resolveConfig(urlArg: string | undefined, opts: CliOptions): AppConfig {
  return {
    url: urlArg ?? process.env.REDIS_URL ?? '',
    port: opts.port,
    host: opts.host,
    auth: resolveAuth({
      enabled: opts.auth,
      username: opts.user,
      password: opts.password,
      passwordEnv: 'REDISDECK_PASSWORD',
    }),
    readonly: opts.readonly,
    tlsInsecure: opts.tlsInsecure,
    basePath: normalizeBasePath(opts.basePath),
    open: opts.open,
    webRoot: resolveWebRoot(),
  };
}

/** Hide the password in a Redis URL before printing it. */
export const redact = (url: string): string => (url ? redactCredentials(url) : 'redis://127.0.0.1:6379');
