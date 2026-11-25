#!/usr/bin/env node
import { listenErrorMessage, onShutdown, openBrowser, parsePositiveInt, serverOptions } from '@deck/cli';
import { serverUrl } from '@deck/config';
import { printFatal } from '@deck/logger';
import { Command, Option } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { DatabaseManager } from '../db/index.js';
import { startServer } from '../server/index.js';
import { printBanner } from './banner.js';
import { redact, resolveConfig, type CliOptions } from './config.js';

/** Deliberately uncommon so it doesn't collide with typical dev servers. */
const DEFAULT_PORT = 47615;

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
    printFatal(`Could not connect to ${redact(config.connectionString)}`, (err as Error).message);
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
    printFatal(listenErrorMessage(err, config.port));
    await manager.closeAll();
    process.exit(1);
  }

  const url = serverUrl(config.host, started.port, config.basePath);
  printBanner(pkg.version, config, info, databaseCount, url, started.port);

  if (config.open) openBrowser(url);

  onShutdown(async () => {
    started.close();
    await manager.closeAll();
  });
}

const server = serverOptions({ defaultPort: DEFAULT_PORT });

const program = new Command()
  .name('pgdeck')
  .description(pkg.description)
  .version(pkg.version, '-v, --version')
  .argument('[connection-string]', 'postgres:// URL (default: $DATABASE_URL, then PG* variables)')
  .addOption(server.port)
  .addOption(server.host)
  .addOption(server.user)
  .addOption(server.password)
  .addOption(server.noAuth)
  .option('--readonly', 'open every session read-only and disable editing', false)
  .option('--ssl', 'connect with SSL without verifying the certificate', false)
  .addOption(server.basePath)
  .addOption(new Option('--max-rows <n>', 'max rows returned per query').argParser(parsePositiveInt).default(2000))
  .addOption(server.open)
  .addHelpText('after', EXAMPLES)
  .action(run);

await program.parseAsync();
