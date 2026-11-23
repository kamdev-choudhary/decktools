import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cell, RowKey, RowsRequest } from '@shared/types';
import { api } from './client';

export const keys = {
  info: ['info'] as const,
  tables: ['tables'] as const,
  meta: (schema: string, table: string) => ['meta', schema, table] as const,
  rowsOf: (schema: string, table: string) => ['rows', schema, table] as const,
  rows: (req: RowsRequest) => ['rows', req.schema, req.table, req] as const,
};

export const useInfo = () => useQuery({ queryKey: keys.info, queryFn: api.info, staleTime: Infinity });

export const useTables = () => useQuery({ queryKey: keys.tables, queryFn: api.tables });

export const useMeta = (schema: string, table: string) =>
  useQuery({ queryKey: keys.meta(schema, table), queryFn: () => api.meta(schema, table) });

export const useRows = (req: RowsRequest) =>
  useQuery({ queryKey: keys.rows(req), queryFn: () => api.rows(req), placeholderData: keepPreviousData });

export function useRowMutations(schema: string, table: string) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: keys.rowsOf(schema, table) });

  return {
    insert: useMutation({
      mutationFn: (values: Record<string, Cell>) => api.insert({ schema, table, values }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ key, values }: { key: RowKey; values: Record<string, Cell> }) =>
        api.update({ schema, table, key, values }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (rowKeys: RowKey[]) => api.remove({ schema, table, keys: rowKeys }),
      onSuccess,
    }),
  };
}

export function useRunQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.query,
    // Arbitrary SQL may have changed data or schema anywhere.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.tables }),
        qc.invalidateQueries({ queryKey: ['meta'] }),
        qc.invalidateQueries({ queryKey: ['rows'] }),
      ]),
  });
}
