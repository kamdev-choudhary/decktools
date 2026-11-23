/**
 * Types shared by the API server and the web UI. Keep this file free of
 * runtime imports so both the Node and browser builds can include it.
 */

/** A cell as returned by the API: Postgres' own text rendering, or null. */
export type Cell = string | null;

/** pg_class.relkind values pgdeck lists. */
export type RelKind = 'r' | 'v' | 'm' | 'p' | 'f';

export const REL_KIND_LABEL: Record<RelKind, string> = {
  r: 'table',
  v: 'view',
  m: 'materialized view',
  p: 'partitioned table',
  f: 'foreign table',
};

export interface DbInfo {
  version: string;
  database: string;
  user: string;
  size: string;
  host: string | null;
  port: number | null;
  readonly: boolean;
}

export interface DatabaseSummary {
  name: string;
  size: string;
}

export interface DatabaseList {
  /** The database named in the connection string (or the server default). */
  default: string;
  databases: DatabaseSummary[];
}

export interface SessionInfo {
  /** False when pgdeck runs with --no-auth. */
  authRequired: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TableRef {
  schema: string;
  name: string;
  kind: RelKind;
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  identity: boolean;
  generated: boolean;
  comment: string | null;
}

export interface Index {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
}

export interface Constraint {
  name: string;
  /** pg_constraint.contype: p, f, u, c, x, t */
  type: string;
  definition: string;
}

/** How a row is identified for edits: primary key columns, physical ctid, or not at all. */
export type KeyMode = 'pk' | 'ctid' | null;

export interface TableMeta {
  schema: string;
  table: string;
  kind: RelKind;
  /** Planner estimate from pg_class.reltuples; -1 if never analyzed. */
  estimate: number;
  size: string;
  comment: string | null;
  columns: Column[];
  primaryKey: string[];
  keyMode: KeyMode;
  editable: boolean;
  indexes: Index[];
  constraints: Constraint[];
}

export const FILTER_OPS = ['=', '!=', '<', '<=', '>', '>=', 'contains', 'like', 'ilike', 'is null', 'is not null'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  col: string;
  op: FilterOp;
  val?: string;
}

export type SortDir = 'asc' | 'desc';

export interface RowsRequest {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sort?: string;
  dir?: SortDir;
  filters?: Filter[];
}

export interface RowsResponse {
  fields: string[];
  rows: Cell[][];
  /** Present when the table has no primary key and rows are addressed by ctid. */
  ctids?: string[];
  total: number;
  totalExact: boolean;
  limit: number;
  offset: number;
}

/** Identifies one row: primary key column values, or `{ ctid }`. */
export type RowKey = Record<string, Cell>;

export interface InsertRequest {
  schema: string;
  table: string;
  values: Record<string, Cell>;
}

export interface UpdateRequest {
  schema: string;
  table: string;
  key: RowKey;
  values: Record<string, Cell>;
}

export interface DeleteRequest {
  schema: string;
  table: string;
  keys: RowKey[];
}

export interface MutationResponse {
  rowCount: number;
}

export interface QueryResult {
  command: string;
  rowCount: number | null;
  fields: string[];
  rows: Cell[][];
  truncated: boolean;
}

export interface QueryResponse {
  ms: number;
  results: QueryResult[];
}

export interface ApiErrorBody {
  error: string;
  detail?: string;
  hint?: string;
  /** 1-based character offset into the submitted SQL. */
  position?: string;
  code?: string;
}
