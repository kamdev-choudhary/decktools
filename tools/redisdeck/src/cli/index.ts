#!/usr/bin/env node
import { listenErrorMessage, onShutdown, openBrowser, serverOptions } from '@deck/cli';
import { serverUrl } from '@deck/config';
import { printFatal } from '@deck/logger';
import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { RedisManager, serverInfo } from '../redis/index.js';
import { startServer } from '../server/index.js';
import { printBanner } from './banner.js';
import { redact, resolveConfig, type CliOptions } from './config.js';

/** Deliberately uncommon so it doesn't collide with typical dev servers (pgdeck uses 47615). */
const DEFAULT_PORT = 47815;

const EXAMPLES = `
Examples:
  $ npx redisdeck
  $ npx redisdeck redis://:secret@localhost:6379/2 --readonly
  $ npx redisdeck rediss://default:secret@cache.example.com:6380 --port 8080

Environment:
  REDIS_URL           connection URL when none is given as an argument
  REDISDECK_PASSWORD  login password (same as --password)
  PORT                port for the web UI (same as --port)
`;

async function run(urlArg: string | undefined, opts: CliOptions): Promise<void> {
  const config = resolveConfig(urlArg, opts);

  let manager: RedisManager;
  try {
    manager = new RedisManager({ url: config.url, readonly: config.readonly, tlsInsecure: config.tlsInsecure });
  } catch (err) {
    printFatal((err as Error).message);
    process.exit(1);
  }

  let info;
  try {
    info = await serverInfo(manager, await manager.connect());
  } catch (err) {
    printFatal(`Could not connect to ${redact(config.url)}`, (err as Error).message);
    await manager.closeAll();
    process.exit(1);
  }

  let started;
  try {
    started = await startServer({ manager, auth: config.auth, basePath: config.basePath, webRoot: config.webRoot, port: config.port, host: config.host });
  } catch (err) {
    printFatal(listenErrorMessage(err, config.port));
    await manager.closeAll();
    process.exit(1);
  }

  const url = serverUrl(config.host, started.port, config.basePath);
  printBanner(pkg.version, config, info, manager.address, url, started.port);
  if (config.open) openBrowser(url);

  onShutdown(async () => {
    started.close();
    await manager.closeAll();
  });
}

const server = serverOptions({ defaultPort: DEFAULT_PORT });

const program = new Command()
  .name('redisdeck')
  .description(pkg.description)
  .version(pkg.version, '-v, --version')
  .argument('[redis-url]', 'redis:// or rediss:// URL (default: $REDIS_URL, then redis://127.0.0.1:6379)')
  .addOption(server.port)
  .addOption(server.host)
  .addOption(server.user)
  .addOption(server.password)
  .addOption(server.noAuth)
  .option('--readonly', 'refuse every change: edits, deletes and write commands', false)
  .option('--tls-insecure', 'with rediss://, skip verifying the server certificate', false)
  .addOption(server.basePath)
  .addOption(server.open)
  .addHelpText('after', EXAMPLES)
  .action(run);

await program.parseAsync();
