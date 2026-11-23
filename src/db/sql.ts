import type { FilterOp } from '../shared/types.js';

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export const qualified = (schema: string, table: string): string => `${quoteIdent(schema)}.${quoteIdent(table)}`;

/** SQL for each filter operator. `col` is a quoted identifier, `param` a placeholder like $1. */
export const FILTER_SQL: Record<FilterOp, (col: string, param: string) => string> = {
  '=': (c, p) => `${c} = ${p}`,
  '!=': (c, p) => `${c} <> ${p}`,
  '<': (c, p) => `${c} < ${p}`,
  '<=': (c, p) => `${c} <= ${p}`,
  '>': (c, p) => `${c} > ${p}`,
  '>=': (c, p) => `${c} >= ${p}`,
  contains: (c, p) => `${c}::text ILIKE '%' || ${p} || '%'`,
  like: (c, p) => `${c}::text LIKE ${p}`,
  ilike: (c, p) => `${c}::text ILIKE ${p}`,
  'is null': (c) => `${c} IS NULL`,
  'is not null': (c) => `${c} IS NOT NULL`,
};

export const isUnaryOp = (op: FilterOp): boolean => op === 'is null' || op === 'is not null';
