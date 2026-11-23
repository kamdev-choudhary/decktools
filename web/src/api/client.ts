import type {
  ApiErrorBody,
  DbInfo,
  DeleteRequest,
  InsertRequest,
  MutationResponse,
  QueryResponse,
  RowsRequest,
  RowsResponse,
  TableMeta,
  TableRef,
  UpdateRequest,
} from '@shared/types';

/**
 * API calls are resolved against the page's own directory, so the UI works
 * whether it's served at "/" or behind a proxy at "/some/prefix/".
 */
const BASE = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;

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

export const api = {
  info: () => request<DbInfo>('info'),
  tables: () => request<TableRef[]>('tables'),
  meta: (schema: string, table: string) =>
    request<TableMeta>(`meta?${new URLSearchParams({ schema, table })}`),
  rows: (req: RowsRequest) => request<RowsResponse>('rows', req),
  insert: (req: InsertRequest) => request<MutationResponse>('insert', req),
  update: (req: UpdateRequest) => request<MutationResponse>('update', req),
  remove: (req: DeleteRequest) => request<MutationResponse>('delete', req),
  query: (sql: string) => request<QueryResponse>('query', { sql }),
};
