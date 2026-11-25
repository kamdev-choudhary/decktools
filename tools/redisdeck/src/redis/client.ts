import { Redis, type RedisOptions } from 'ioredis';
import { createLogger } from '@deck/logger';
import { UserError } from './errors.js';

const log = createLogger('redisdeck');

export interface RedisConfig {
  /** redis:// or rediss:// URL; empty for 127.0.0.1:6379. */
  url: string;
  readonly: boolean;
  /** rediss:// without verifying the server certificate. */
  tlsInsecure: boolean;
}

/** Connection settings from a redis:// URL, minus the database. */
export function connectionOptions(url: string, tlsInsecure: boolean): { options: RedisOptions; defaultDb: number } {
  if (!url) return { options: { host: '127.0.0.1', port: 6379 }, defaultDb: 0 };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid Redis URL: expected redis://[user:password@]host[:port][/db]`);
  }
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') {
    throw new Error(`Unsupported scheme "${u.protocol}": use redis:// or rediss:// (TLS)`);
  }
  const db = u.pathname.replace(/^\//, '');
  const options: RedisOptions = {
    host: u.hostname.replace(/^\[|\]$/g, '') || '127.0.0.1',
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
  if (u.protocol === 'rediss:') options.tls = tlsInsecure ? { rejectUnauthorized: false } : {};
  return { options, defaultDb: db && /^\d+$/.test(db) ? Number(db) : 0 };
}

/**
 * One connection per logical database, opened on first use (SELECT is
 * per-connection, so each database gets its own). Console commands use a
 * second connection per database that returns integers as exact strings.
 */
export class RedisManager {
  private readonly clients = new Map<string, Redis>();
  private readonly base: RedisOptions;
  readonly defaultDb: number;
  private dbCount = 16;

  constructor(readonly config: RedisConfig) {
    const { options, defaultDb } = connectionOptions(config.url, config.tlsInsecure);
    this.base = {
      ...options,
      connectionName: 'redisdeck',
      protocol: 2,
      lazyConnect: true,
      connectTimeout: 5000,
      // Fail requests fast while Redis is down instead of queueing them forever.
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 250, 3000),
    };
    this.defaultDb = defaultDb;
  }

  get readonly(): boolean {
    return this.config.readonly;
  }

  get databases(): number {
    return this.dbCount;
  }

  /** "host:port" for display. */
  get address(): string {
    return `${this.base.host}:${this.base.port}`;
  }

  /** Connect to the default database once, without retrying, so startup fails clearly. */
  async connect(): Promise<Redis> {
    const probe = new Redis({ ...this.base, db: this.defaultDb, retryStrategy: () => null });
    let cause: Error | null = null;
    probe.on('error', (err: Error) => (cause ??= err));
    try {
      await probe.connect();
    } catch (err) {
      probe.disconnect();
      const reason = cause ?? (err as Error);
      throw new Error(reason.message || (reason as AggregateError).errors?.map((e: Error) => e.message).join(', ') || String(reason), { cause: err });
    }
    probe.disconnect();
    const client = await this.get(this.defaultDb);
    // Managed services may hide CONFIG; 16 is the Redis default.
    try {
      const [, value] = (await client.call('CONFIG', ['GET', 'databases'])) as [string, string];
      if (Number(value) > 0) this.dbCount = Number(value);
    } catch {
      /* keep 16 */
    }
    return client;
  }

  /** The connection for a database, opened on first use. */
  async get(db: number, kind: 'data' | 'console' = 'data'): Promise<Redis> {
    if (!Number.isInteger(db) || db < 0 || db >= this.dbCount) {
      throw new UserError(`Database ${db} doesn't exist (this server has ${this.dbCount}: 0 to ${this.dbCount - 1})`, 404);
    }
    const id = `${kind}:${db}`;
    let client = this.clients.get(id);
    if (!client) {
      client = new Redis({ ...this.base, db, stringNumbers: kind === 'console' });
      client.on('error', (err: Error) => log.warn(`db ${db}:`, err.message));
      this.clients.set(id, client);
      await client.connect().catch(() => {
        /* commands report the failure; ioredis keeps retrying in the background */
      });
    }
    return client;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.quit().catch(() => c.disconnect())));
    this.clients.clear();
  }
}
