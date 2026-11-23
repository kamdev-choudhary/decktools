import type {
  ApiErrorBody,
  Cell,
  DatabaseList,
  DbStats,
  DbInfo,
  LoginRequest,
  MutationResponse,
  QueryResponse,
  RowKey,
  RowsRequest,
  RowsResponse,
  SessionInfo,
  TableAction,
  TableMeta,
  TableRef,
} from '@shared/types';

/**
 * API calls are resolved against the page's own directory, so the UI works
 * whether it's served at "/" or behind a proxy at "/some/prefix/".
 */
export const BASE = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;

export class ApiError extends Error {
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: number;
  readonly code?: string;

  constructor(
    body: ApiErrorBody,
    readonly status: number,
  ) {
    super(body.error);
    this.name = 'ApiError';
    this.detail = body.detail;
    this.hint = body.hint;
    this.position = body.position ? Number(body.position) : undefined;
    this.code = body.code;
  }
}

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-pgdeck': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))) as T | ApiErrorBody;
  if (!res.ok) throw new ApiError(data as ApiErrorBody, res.status);
  return data as T;
}

const db = (name: string, path: string) => `db/${encodeURIComponent(name)}/${path}`;

export const api = {
  session: () => request<SessionInfo>('auth/session'),
  login: (body: LoginRequest) => request<SessionInfo>('auth/login', body),
  logout: () => request<SessionInfo>('auth/logout', {}),

  databases: () => request<DatabaseList>('databases'),

  info: (database: string) => request<DbInfo>(db(database, 'info')),
  tables: (database: string) => request<TableRef[]>(db(database, 'tables')),
  meta: (database: string, schema: string, table: string) =>
    request<TableMeta>(db(database, `meta?${new URLSearchParams({ schema, table })}`)),
  rows: (database: string, req: RowsRequest) => request<RowsResponse>(db(database, 'rows'), req),
  insert: (database: string, schema: string, table: string, values: Record<string, Cell>) =>
    request<MutationResponse>(db(database, 'insert'), { schema, table, values }),
  update: (database: string, schema: string, table: string, key: RowKey, values: Record<string, Cell>) =>
    request<MutationResponse>(db(database, 'update'), { schema, table, key, values }),
  remove: (database: string, schema: string, table: string, keys: RowKey[]) =>
    request<MutationResponse>(db(database, 'delete'), { schema, table, keys }),
  query: (database: string, sql: string) => request<QueryResponse>(db(database, 'query'), { sql }),
  stats: (database: string) => request<DbStats>(db(database, 'stats')),
  tableAction: (database: string, schema: string, table: string, action: TableAction) =>
    request<{ ok: true; message: string }>(db(database, 'table-action'), { schema, table, action }),
  ddl: (database: string, schema: string, table: string) =>
    request<{ sql: string }>(db(database, `ddl?${new URLSearchParams({ schema, table })}`)),
};
