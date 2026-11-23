import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cell, LoginRequest, RowKey, RowsRequest, SessionInfo } from '@shared/types';
import { api } from './client';

export const keys = {
  session: ['session'] as const,
  databases: ['databases'] as const,
  /** Everything cached for one database. */
  db: (db: string) => ['db', db] as const,
  info: (db: string) => ['db', db, 'info'] as const,
  tables: (db: string) => ['db', db, 'tables'] as const,
  meta: (db: string, schema: string, table: string) => ['db', db, 'meta', schema, table] as const,
  rowsOf: (db: string, schema: string, table: string) => ['db', db, 'rows', schema, table] as const,
  rows: (db: string, req: RowsRequest) => ['db', db, 'rows', req.schema, req.table, req] as const,
};

/* Auth */

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: api.session, staleTime: Infinity });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.login(body),
    onSuccess: (session) => qc.setQueryData<SessionInfo>(keys.session, session),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: (session) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      qc.setQueryData<SessionInfo>(keys.session, session);
    },
  });
}

/* Server & databases */

export const useDatabases = () => useQuery({ queryKey: keys.databases, queryFn: api.databases });

export const useInfo = (db: string) => useQuery({ queryKey: keys.info(db), queryFn: () => api.info(db) });

export const useTables = (db: string) => useQuery({ queryKey: keys.tables(db), queryFn: () => api.tables(db) });

export const useMeta = (db: string, schema: string, table: string) =>
  useQuery({ queryKey: keys.meta(db, schema, table), queryFn: () => api.meta(db, schema, table) });

export const useRows = (db: string, req: RowsRequest) =>
  useQuery({ queryKey: keys.rows(db, req), queryFn: () => api.rows(db, req), placeholderData: keepPreviousData });

/* Mutations */

export function useRowMutations(db: string, schema: string, table: string) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: keys.rowsOf(db, schema, table) });

  return {
    insert: useMutation({
      mutationFn: (values: Record<string, Cell>) => api.insert(db, schema, table, values),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ key, values }: { key: RowKey; values: Record<string, Cell> }) =>
        api.update(db, schema, table, key, values),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (rowKeys: RowKey[]) => api.remove(db, schema, table, rowKeys),
      onSuccess,
    }),
  };
}

export function useRunQuery(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sql: string) => api.query(db, sql),
    // Arbitrary SQL may have changed data or schema anywhere in this database.
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.db(db) }),
  });
}
