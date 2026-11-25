#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import pkg from '../../package.json' with { type: 'json' };
import { errorMessage } from '../s3/errors';
import { ConnectionRegistry, connectionFromSaved, openConnection } from '../server/connections';
import { JobRegistry } from '../server/jobs';
import { SsoService, ssoConfigFromEnv } from '../server/sso';
import { ActivityLog } from '../server/store/activity';
import { loadSecretKey } from '../server/store/crypto';
import { ensureDir, resolveDataDir } from '../server/store/files';
import { SavedConnectionStore } from '../server/store/saved-connections';
import { UserStore } from '../server/store/users';
import type { ServerContext } from '../server/context';
import { RateLimiter } from '../server/middleware/rate-limit';
import { SessionStore } from '../server/sessions';
import { startServer } from '../server/start';
import { ZipTokens } from '../server/zip-tokens';
import { printBanner, type BannerInfo } from './banner';
import { resolveStartupConnection } from './credentials';
import { buildProgram, parseOptions } from './options';

function generatePassword(): string {
  return randomBytes(9).toString('base64url'); // 12 characters
}

/** dist/web next to the built CLI, or the repo's dist/web when running from source. */
function findWebRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, 'web'), path.resolve(here, '../../dist/web')];
  return candidates.find((p) => existsSync(path.join(p, 'index.html'))) ?? null;
}

async function main() {
  const program = buildProgram(pkg.version);
  program.parse();
  const opts = parseOptions(program);

  const password = opts.password ?? generatePassword();
  const registry = new ConnectionRegistry();

  // Connect with the startup credentials, if there are any.
  let connection: BannerInfo['connection'];
  try {
    const { spec, reason } = await resolveStartupConnection(opts);
    if (!spec) {
      connection = { ok: false, message: `no credentials found ${pc.dim(`(${reason})`)}` };
    } else {
      const { connection: conn, bucketCount } = await openConnection(spec);
      registry.setDefault(conn);
      connection = {
        ok: true,
        providerName: conn.provider.name,
        endpoint: conn.endpoint,
        region: conn.region,
        bucketCount,
        pinned: conn.pinnedBuckets.length,
      };
    }
  } catch (err) {
    connection = { ok: false, message: `could not connect: ${errorMessage(err)}` };
  }

  if (!connection.ok && !opts.browserConnections) {
    console.error(pc.red(`\n  s3deck: ${connection.message}\n`));
    process.exit(1);
  }

  // Data directory: users, remembered connections (encrypted) and the activity log.
  let dataDir: string | null = null;
  let users: UserStore | null = null;
  let saved: SavedConnectionStore | null = null;
  let persistNote: string;
  if (opts.persist) {
    const dir = resolveDataDir(opts.dataDir);
    try {
      await ensureDir(dir);
      const key = await loadSecretKey(dir);
      users = new UserStore(dir);
      await users.load();
      saved = new SavedConnectionStore(dir, key);
      await saved.load();
      for (const item of saved.all()) registry.add(connectionFromSaved(item));
      dataDir = dir;
      persistNote = dir;
    } catch (err) {
      users = null;
      saved = null;
      persistNote = pc.yellow(`unavailable (${errorMessage(err)})`);
    }
  } else {
    persistNote = 'off (--no-persist)';
  }

  const ssoConfig = ssoConfigFromEnv();
  const activity = new ActivityLog(dataDir);
  await activity.load().catch(() => {});

  const webRoot = opts.dev ? null : findWebRoot();
  if (!opts.dev && !webRoot) console.warn(pc.yellow('  Web UI not found. Run "pnpm build" first.'));

  const ctx: ServerContext = {
    config: {
      host: opts.host,
      port: opts.port,
      basePath: opts.basePath,
      auth: { enabled: opts.auth, user: opts.user, password },
      readonly: opts.readonly,
      version: pkg.version,
      webRoot,
      allowBrowserConnections: opts.browserConnections,
      dataDir,
      publicUrl: opts.publicUrl ?? null,
      dev: opts.dev,
    },
    sessions: new SessionStore(),
    connections: registry,
    zipTokens: new ZipTokens(),
    loginLimiter: new RateLimiter(10, 15 * 60 * 1000),
    users,
    saved,
    activity,
    jobs: new JobRegistry(),
    sso: ssoConfig ? new SsoService(ssoConfig) : null,
  };

  let started;
  try {
    started = await startServer(ctx);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const msg = code === 'EADDRINUSE' ? `port ${opts.port} is already in use (try --port)` : errorMessage(err);
    console.error(pc.red(`\n  s3deck: ${msg}\n`));
    process.exit(1);
  }

  const displayHost = opts.host === '0.0.0.0' || opts.host === '::' ? '127.0.0.1' : opts.host;
  const hostPart = displayHost.includes(':') ? `[${displayHost}]` : displayHost;
  const url = `http://${hostPart}:${started.port}${opts.basePath}/`;

  printBanner({
    version: pkg.version,
    connection,
    url,
    host: opts.host,
    port: started.port,
    auth: { enabled: opts.auth, user: opts.user, password, generated: !opts.password },
    readonly: opts.readonly,
    browserConnections: opts.browserConnections,
    dev: opts.dev,
    data: {
      dir: persistNote,
      users: users?.list().length ?? 0,
      savedConnections: saved?.all().length ?? 0,
      sso: ssoConfig ? ssoConfig.issuer : null,
    },
  });

  if (opts.open) {
    const { default: open } = await import('open');
    await open(opts.dev ? 'http://localhost:47716/' : url).catch(() => {});
  }

  const shutdown = () => {
    ctx.sessions.close();
    started.server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(pc.red(`\n  s3deck: ${errorMessage(err)}\n`));
  process.exit(1);
});
