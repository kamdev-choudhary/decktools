import type pg from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import type { DatabaseList, DatabaseSummary } from '../shared/types.js';
import { UserError } from './errors.js';
import { createDatabase, type Database } from './database.js';

export interface ManagerConfig {
  /** postgres:// URL or key=value string. Empty means PG* environment defaults. */
  connectionString: string;
  /** Use SSL without certificate verification. */
  ssl: boolean;
  readonly: boolean;
  maxRows: number;
  /** Max databases with an open pool at once; the least recently used is closed. */
  maxOpenPools?: number;
}

/**
 * Owns one connection pool per database on the server, created on first use,
 * so the UI can switch databases without restarting pgdeck.
 */
export class DatabaseManager {
  private readonly base: pg.ClientConfig;
  private readonly pools = new Map<string, Database>();
  private known: Set<string> | null = null;
  private defaultName = '';

  constructor(private readonly config: ManagerConfig) {
    const parsed = config.connectionString ? parseIntoClientConfig(config.connectionString) : {};
    this.base = {
      ...parsed,
      ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  }

  get readonly(): boolean {
    return this.config.readonly;
  }

  /** The database the connection string (or PG* defaults) points at. */
  get defaultDatabase(): string {
    return this.defaultName;
  }

  /** Connect to the default database and fail fast if the server is unreachable. */
  async connect(): Promise<Database> {
    const db = this.open(this.base.database ?? '', this.base);
    const info = await db.info();
    this.defaultName = info.database;
    if (!this.base.database) {
      // We connected without naming a database; file the pool under its real name.
      this.pools.delete('');
      this.pools.set(info.database, db);
    }
    return db;
  }

  async list(): Promise<DatabaseList> {
    const db = await this.get(this.defaultName);
    const databases = await db.listDatabases();
    this.known = new Set(databases.map((d: DatabaseSummary) => d.name));
    return { default: this.defaultName, databases };
  }

  /** Get the handle for a database, opening its pool if needed. */
  async get(name: string): Promise<Database> {
    const existing = this.pools.get(name);
    if (existing) {
      // Re-insert to mark as most recently used.
      this.pools.delete(name);
      this.pools.set(name, existing);
      return existing;
    }
    // Only open pools for databases that actually exist, so arbitrary names
    // in URLs can't make us hold connections open.
    if (!this.known?.has(name)) await this.list();
    if (!this.known?.has(name)) throw new UserError(`Database "${name}" does not exist or you cannot connect to it`, 404);
    return this.open(name, { ...this.base, database: name });
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.pools.values()].map((db) => db.close()));
    this.pools.clear();
  }

  private open(name: string, client: pg.ClientConfig): Database {
    const db = createDatabase({ client, readonly: this.config.readonly, maxRows: this.config.maxRows });
    this.pools.set(name, db);
    this.evict();
    return db;
  }

  private evict(): void {
    const max = this.config.maxOpenPools ?? 6;
    for (const [name, db] of this.pools) {
      if (this.pools.size <= max) break;
      if (name === this.defaultName) continue;
      this.pools.delete(name);
      void db.close().catch(() => {});
    }
  }
}
