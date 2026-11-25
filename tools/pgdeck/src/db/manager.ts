import type pg from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import type { DatabaseList, DatabaseSummary } from '../shared/types.js';
import { UserError } from './errors.js';
import { createDatabase, type Database } from './database.js';
import { quoteIdent } from './sql.js';

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
    if (!this.known?.has(name))
      throw new UserError(`Database "${name}" does not exist or you cannot connect to it`, 404);
    return this.open(name, { ...this.base, database: name });
  }

  /* Database administration. Statements run on the default database's pool. */

  private async admin(): Promise<Database> {
    if (this.config.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
    return this.get(this.defaultName);
  }

  /** Close a database's pool so it can be dropped, renamed or used as a template. */
  private async release(name: string): Promise<void> {
    const db = this.pools.get(name);
    if (!db) return;
    this.pools.delete(name);
    await db.close().catch(() => {});
  }

  private guardDefault(name: string, verb: string): void {
    if (name === this.defaultName) {
      throw new UserError(
        `"${name}" is the database pgdeck connects through, so it can't be ${verb} from here. Connect pgdeck to another database first.`,
        409,
      );
    }
  }

  async createDb(name: string, opts: { template?: string; owner?: string }): Promise<{ ok: true; message: string }> {
    const admin = await this.admin();
    let sql = `CREATE DATABASE ${quoteIdent(name)}`;
    if (opts.owner) sql += ` OWNER ${quoteIdent(opts.owner)}`;
    if (opts.template) {
      // Copying needs the template to have no other sessions, including ours.
      this.guardDefault(opts.template, 'copied');
      await this.release(opts.template);
      sql += ` TEMPLATE ${quoteIdent(opts.template)}`;
    }
    await admin.exec(sql);
    this.known = null;
    return {
      ok: true,
      message: opts.template ? `Created ${name} as a copy of ${opts.template}` : `Created database ${name}`,
    };
  }

  async renameDb(name: string, newName: string): Promise<{ ok: true; message: string }> {
    const admin = await this.admin();
    this.guardDefault(name, 'renamed');
    await this.release(name);
    await admin.exec(`ALTER DATABASE ${quoteIdent(name)} RENAME TO ${quoteIdent(newName)}`);
    this.known = null;
    return { ok: true, message: `Renamed ${name} to ${newName}` };
  }

  async dropDb(name: string, force: boolean): Promise<{ ok: true; message: string }> {
    const admin = await this.admin();
    this.guardDefault(name, 'dropped');
    await this.release(name);
    await admin.exec(`DROP DATABASE ${quoteIdent(name)}${force ? ' WITH (FORCE)' : ''}`);
    this.known = null;
    return { ok: true, message: `Dropped database ${name}` };
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
