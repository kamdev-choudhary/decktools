import pg from 'pg';
import type { Cell } from '../shared/types.js';

export interface DbConfig {
  /** Connection settings for one specific database. Missing fields fall back to PG* env vars. */
  client: pg.ClientConfig;
  /** Open every session with default_transaction_read_only and refuse edits. */
  readonly: boolean;
  /** Cap on rows returned by any single query. */
  maxRows: number;
}

export interface DbContext {
  pool: pg.Pool;
  readonly: boolean;
  maxRows: number;
}

/**
 * Return every value exactly as Postgres renders it as text. Display stays
 * faithful (no JS Date timezone shifts, no bigint precision loss) and edits
 * round-trip: what the UI shows can be sent back and Postgres casts it.
 */
export const RAW_TYPES = {
  getTypeParser: () => (value: string) => value,
} as unknown as pg.CustomTypesConfig;

export function createPool(config: DbConfig): pg.Pool {
  const pool = new pg.Pool({
    ...config.client,
    max: 4,
    idleTimeoutMillis: 30_000,
    application_name: 'pgdeck',
    options: config.readonly ? '-c default_transaction_read_only=on' : undefined,
  });
  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => console.error('[pgdeck] idle client error:', err.message));
  return pool;
}

/** Run a query returning rows as arrays of raw text cells. */
export function queryRaw(pool: pg.Pool, text: string, values?: unknown[]): Promise<pg.QueryArrayResult<Cell[]>> {
  return pool.query<Cell[]>({ text, values, rowMode: 'array', types: RAW_TYPES });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
