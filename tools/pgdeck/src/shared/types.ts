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

/** Auth wire contract, shared by every deck. */
export type { SessionInfo } from '@deck/server/types';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TableRef {
  schema: string;
  name: string;
  kind: RelKind;
}

/** Per-relation storage and maintenance stats for the overview page. */
export interface TableStats {
  schema: string;
  name: string;
  kind: RelKind;
  /** Live rows from pg_stat (or the planner estimate if never analyzed). */
  rows: number;
  deadRows: number;
  tableBytes: number;
  indexBytes: number;
  totalBytes: number;
  indexCount: number;
  seqScans: number | null;
  indexScans: number | null;
  /** Most recent manual or auto vacuum / analyze, ISO timestamps. */
  lastVacuum: string | null;
  lastAnalyze: string | null;
}

export interface DbStats {
  sizeBytes: number;
  uptimeSeconds: number;
  serverVersion: string;
  connections: { total: number; active: number; idle: number; idleInTransaction: number; max: number };
  /** Share of block reads served from shared buffers, 0..1; null before any reads. */
  cacheHitRatio: number | null;
  transactions: { commits: number; rollbacks: number };
  tuples: { inserted: number; updated: number; deleted: number; fetched: number };
  deadlocks: number;
  tempBytes: number;
  /** When pg_stat_database counters were last reset (or null = since server start). */
  statsSince: string | null;
  extensions: { name: string; version: string }[];
  tables: TableStats[];
}

/** A query running (or idle) on the database right now, from pg_stat_activity. */
export interface LiveActivity {
  pid: number;
  user: string | null;
  application: string;
  client: string | null;
  state: string | null;
  waitEvent: string | null;
  /** Seconds since the current query (or transaction, if idle in one) started. */
  durationSeconds: number | null;
  query: string;
}

/** One sample pushed over the live WebSocket, every few seconds. */
export interface LiveSample {
  type: 'sample';
  /** Epoch milliseconds. */
  t: number;
  connections: { total: number; active: number; idle: number; idleInTransaction: number; max: number };
  /** Rates over the interval since the previous sample (0 for the first). */
  commitsPerSec: number;
  rollbacksPerSec: number;
  rowsReadPerSec: number;
  rowsWrittenPerSec: number;
  /** Cache hit ratio over the interval; null when there were no block reads. */
  cacheHitRatio: number | null;
  /** Client sessions other than pgdeck's own pool. */
  activity: LiveActivity[];
}

export type LiveMessage = LiveSample | { type: 'error'; error: string };

export interface Column {
  name: string;
  /** Formatted type, e.g. "character varying(255)", "timestamp(3) with time zone". */
  type: string;
  /** Underlying type name, e.g. "varchar", "timestamptz", "jsonb", "uuid", or the enum's name. */
  typeName: string;
  /**
   * pg_type.typcategory: A array, B boolean, D date/time, E enum, N numeric,
   * S string, U user-defined (json, uuid, ...), and others.
   */
  category: string;
  /** Allowed labels when the column is an enum, in their declared order. */
  enumValues: string[] | null;
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

/** An outgoing foreign key: these columns reference refColumns of another table. */
export interface ForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
}

/** An incoming foreign key: another table's columns reference this table. */
export interface IncomingReference {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  refColumns: string[];
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
  foreignKeys: ForeignKey[];
  referencedBy: IncomingReference[];
}

export const FILTER_OPS = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'not contains',
  'starts with',
  'ends with',
  'in',
  'not in',
  'like',
  'ilike',
  'is null',
  'is not null',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  col: string;
  op: FilterOp;
  val?: string;
}

export type SortDir = 'asc' | 'desc';

/** Whole-table operations from the table menu. */
export type TableAction =
  | { action: 'truncate'; cascade: boolean; restartIdentity: boolean }
  | { action: 'drop'; cascade: boolean }
  | { action: 'rename'; newName: string }
  | { action: 'duplicate'; newName: string; withData: boolean }
  | { action: 'vacuum'; full: boolean }
  | { action: 'analyze' }
  | { action: 'refresh' };

/** How multiple filter conditions combine: every one must match, or any one. */
export type FilterMatch = 'and' | 'or';

/** Operators whose value is a comma-separated list. */
export const LIST_OPS: readonly FilterOp[] = ['in', 'not in'];
/** Operators that take no value. */
export const UNARY_OPS: readonly FilterOp[] = ['is null', 'is not null'];

export interface RowsRequest {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sort?: string;
  dir?: SortDir;
  filters?: Filter[];
  match?: FilterMatch;
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

/* Query performance */

/** One node of an EXPLAIN (FORMAT JSON) plan. Keys are Postgres' own. */
export interface PlanNode {
  'Node Type': string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface ExplainResponse {
  plan: { Plan: PlanNode; 'Planning Time'?: number; 'Execution Time'?: number; [key: string]: unknown };
  analyzed: boolean;
  /** Planned with GENERIC_PLAN because the query has $n parameters. */
  generic: boolean;
  ms: number;
}

export type StatementSort = 'total' | 'mean' | 'calls' | 'rows';

export interface StatementStat {
  id: string;
  query: string;
  calls: number;
  totalMs: number;
  meanMs: number;
  rows: number;
  cacheHitRatio: number | null;
  tempWrittenBlocks: number;
}

export interface StatementsResponse {
  /** not-preloaded: missing from shared_preload_libraries; not-created: needs CREATE EXTENSION. */
  status: 'ok' | 'not-created' | 'not-preloaded' | 'unavailable';
  statements: StatementStat[];
  totalMs: number;
}

/* ER diagram */

export interface GraphColumn {
  name: string;
  type: string;
  nullable: boolean;
  /** Position in the primary key (1-based), or 0. */
  pk: number;
}

export interface GraphTable {
  schema: string;
  name: string;
  kind: RelKind;
  columns: GraphColumn[];
  /** Planner estimate, -1 when never analyzed. */
  rows: number;
  comment: string | null;
}

export interface GraphForeignKey {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onDelete: string;
}

export interface SchemaGraph {
  tables: GraphTable[];
  foreignKeys: GraphForeignKey[];
}

/* Functions, triggers, sequences, extensions */

export type ObjectKind = 'function' | 'trigger' | 'sequence' | 'extension';

export interface FunctionRef {
  oid: number;
  schema: string;
  name: string;
  args: string;
  /** f function, p procedure, a aggregate, w window */
  kind: string;
  returns: string | null;
  language: string;
}
export interface TriggerRef {
  oid: number;
  schema: string;
  table: string;
  name: string;
  enabled: boolean;
  function: string;
}
export interface SequenceRef {
  oid: number;
  schema: string;
  name: string;
  /** table.column the sequence belongs to (serial / identity), if any */
  ownedBy: string | null;
  lastValue: string | null;
}
export interface ExtensionRef {
  oid: number;
  name: string;
  version: string;
  schema: string;
  defaultVersion: string | null;
  comment: string | null;
}
export interface DbObjects {
  functions: FunctionRef[];
  triggers: TriggerRef[];
  sequences: SequenceRef[];
  extensions: ExtensionRef[];
}
export interface AvailableExtension {
  name: string;
  defaultVersion: string;
  comment: string | null;
}

/** Everything the object page shows: a definition plus labelled properties. */
export interface ObjectDetail {
  kind: ObjectKind;
  oid: number;
  name: string;
  schema: string | null;
  /** Display title, e.g. "calc_total(integer, text)". */
  title: string;
  definition: string;
  /** Whether `definition` can be edited and re-run as-is (CREATE OR REPLACE). */
  editable: boolean;
  properties: [string, string][];
  /** Trigger: its function, so it can be viewed and edited in place. */
  triggerFunction?: { oid: number; title: string; definition: string } | null;
  /** Sequence: settings for the "set next value" dialog. */
  sequence?: { lastValue: string | null; increment: string; min: string; max: string };
  /** Extension: newer version available. */
  update?: string | null;
}

export type ObjectAction =
  | { kind: 'function'; oid: number; action: 'replace'; sql: string }
  | { kind: 'function'; oid: number; action: 'drop'; cascade: boolean }
  | { kind: 'trigger'; oid: number; action: 'enable' | 'disable' }
  | { kind: 'trigger'; oid: number; action: 'drop'; cascade: boolean }
  | { kind: 'sequence'; oid: number; action: 'restart'; value: string }
  | { kind: 'sequence'; oid: number; action: 'drop'; cascade: boolean }
  | { kind: 'extension'; oid: number; action: 'update' }
  | { kind: 'extension'; oid: number; action: 'drop'; cascade: boolean }
  | { kind: 'extension'; action: 'create'; name: string };
