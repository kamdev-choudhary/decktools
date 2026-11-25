import { InvalidArgumentError, Option } from 'commander';

export function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new InvalidArgumentError('must be an integer between 0 and 65535');
  return n;
}

export function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
}

/** What commander parses from the flags created by serverOptions(). */
export interface ServerCliOptions {
  port: number;
  host: string;
  user: string;
  password?: string;
  auth: boolean; // false when --no-auth is passed
  basePath: string;
  open: boolean;
}

export interface ServerOptionsInit {
  /** Default port; $PORT overrides it. Pick an uncommon one per tool so decks can run side by side. */
  defaultPort: number;
}

/**
 * The flags every deck's web UI accepts. Returned as individual Options so a
 * tool can interleave its own flags and control the order shown in --help:
 *
 *   const o = serverOptions({ defaultPort: 47615 });
 *   program.addOption(o.port).addOption(o.host)...addOption(o.open);
 */
export function serverOptions({ defaultPort }: ServerOptionsInit) {
  return {
    port: new Option('-p, --port <port>', 'port for the web UI').argParser(parsePort).default(Number(process.env.PORT) || defaultPort),
    host: new Option('-H, --host <host>', 'interface to bind (0.0.0.0 for containers/LAN)').default('127.0.0.1'),
    user: new Option('-u, --user <name>', 'login username').default('admin'),
    password: new Option('-P, --password <password>', 'login password (default: random, printed at startup)'),
    noAuth: new Option('--no-auth', 'disable the login prompt (only on a trusted host)'),
    basePath: new Option('--base-path <path>', 'serve under a path prefix, e.g. /db, if your proxy does not strip it').default(''),
    open: new Option('--open', 'open the UI in your browser').default(false),
  };
}
