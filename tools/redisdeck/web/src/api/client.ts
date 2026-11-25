import type {
  ApiErrorBody,
  CommandResult,
  KeyAction,
  KeyDetail,
  KeyPage,
  KeySummary,
  LoginRequest,
  NewKey,
  ServerInfo,
  SessionInfo,
  SlowlogEntry,
  StatsSample,
} from '@shared/types';

/** API base relative to the page, so the UI works under any path prefix. */
export const BASE = new URL('.', location.href).pathname;

export class ApiError extends Error {
  constructor(
    body: ApiErrorBody,
    readonly status: number,
  ) {
    super(body.error);
    this.name = 'ApiError';
  }
}

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-redisdeck': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))) as T | ApiErrorBody;
  if (!res.ok) throw new ApiError(data as ApiErrorBody, res.status);
  return data as T;
}

const q = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();

export const api = {
  session: () => request<SessionInfo>('auth/session'),
  login: (body: LoginRequest) => request<SessionInfo>('auth/login', body),
  logout: () => request<SessionInfo>('auth/logout', {}),

  server: () => request<ServerInfo>('server'),
  stats: () => request<StatsSample>('stats'),
  slowlog: () => request<SlowlogEntry[]>('slowlog'),

  keys: (db: number, p: { cursor: string; match: string; type?: string }) => request<KeyPage>(`db/${db}/keys?${q(p)}`),
  size: (db: number) => request<{ keys: number }>(`db/${db}/size`),
  key: (db: number, id: string, page: { cursor?: string; offset?: number } = {}) =>
    request<KeyDetail>(`db/${db}/key?${q({ id, cursor: page.cursor, offset: page.offset })}`),
  action: (db: number, action: KeyAction) => request<{ ok: true; message: string }>(`db/${db}/key/action`, action),
  create: (db: number, spec: NewKey) => request<KeySummary>(`db/${db}/key/create`, spec),
  command: (db: number, command: string) => request<CommandResult>(`db/${db}/command`, { command }),
};
