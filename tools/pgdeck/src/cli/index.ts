#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from 'commander';
import open from 'open';
import pc from 'picocolors';
import pkg from '../../package.json' with { type: 'json' };
import { DatabaseManager } from '../db/index.js';
import { startServer } from '../server/index.js';
import { printBanner } from './banner.js';
import { redact, resolveConfig, type CliOptions } from './config.js';

/** Deliberately uncommon so it doesn't collide with typical dev servers. */
const DEFAULT_PORT = 47615;

function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new InvalidArgumentError('must be an integer between 0 and 65535');
  return n;
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
}

const EXAMPLES = `
Examples:
  $ npx pgdeck postgres://me:secret@localhost:5432/app
  $ npx pgdeck "$DATABASE_URL" --readonly --port 8080
  $ npx pgdeck postgres://... --host 0.0.0.0 --password hunter2 --base-path /db

Environment:
  DATABASE_URL      connection string when none is given as an argument
  PG*               PGHOST, PGUSER, PGDATABASE... used when neither is set
  PGDECK_PASSWORD   login password (same as --password)
  PORT              port for the web UI (same as --port)
`;

async function run(connection: string | undefined, opts: CliOptions): Promise<void> {
  const config = resolveConfig(connection, opts);
  const manager = new DatabaseManager({
    connectionString: config.connectionString,
    ssl: config.ssl,
    readonly: config.readonly,
    maxRows: config.maxRows,
  });

  let info;
  let databaseCount;
  try {
    info = await (await manager.connect()).info();
    databaseCount = (await manager.list()).databases.length;
  } catch (err) {
    console.error(`\n  ${pc.red('✗')} Could not connect to ${redact(config.connectionString)}\n    ${(err as Error).message}\n`);
    await manager.closeAll();
    process.exit(1);
  }

  let started;
  try {
    started = await startServer({
      manager,
      auth: config.auth,
      basePath: config.basePath,
      webRoot: config.webRoot,
      port: config.port,
      host: config.host,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const msg = e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Try --port ${config.port + 1}` : e.message;
    console.error(`\n  ${pc.red('✗')} ${msg}\n`);
    await manager.closeAll();
    process.exit(1);
  }

  const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const url = `http://${shownHost}:${started.port}${config.basePath}/`;
  printBanner(pkg.version, config, info, databaseCount, url, started.port);

  if (config.open) open(url).catch(() => {});

  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(pc.dim('\n  Shutting down...'));
    started.close();
    await manager.closeAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const program = new Command()
  .name('pgdeck')
  .description(pkg.description)
  .version(pkg.version, '-v, --version')
  .argument('[connection-string]', 'postgres:// URL (default: $DATABASE_URL, then PG* variables)')
  .addOption(new Option('-p, --port <port>', 'port for the web UI').argParser(parsePort).default(Number(process.env.PORT) || DEFAULT_PORT))
  .option('-H, --host <host>', 'interface to bind (0.0.0.0 for containers/LAN)', '127.0.0.1')
  .option('-u, --user <name>', 'login username', 'admin')
  .option('-P, --password <password>', 'login password (default: random, printed at startup)')
  .option('--no-auth', 'disable the login prompt (only on a trusted host)')
  .option('--readonly', 'open every session read-only and disable editing', false)
  .option('--ssl', 'connect with SSL without verifying the certificate', false)
  .option('--base-path <path>', 'serve under a path prefix, e.g. /db, if your proxy does not strip it', '')
  .addOption(new Option('--max-rows <n>', 'max rows returned per query').argParser(parsePositiveInt).default(2000))
  .option('--open', 'open the UI in your browser', false)
  .addHelpText('after', EXAMPLES)
  .action(run);

await program.parseAsync();
