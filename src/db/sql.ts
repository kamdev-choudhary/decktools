import { LIST_OPS, UNARY_OPS, type FilterOp } from '../shared/types.js';

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
  'not contains': (c, p) => `${c}::text NOT ILIKE '%' || ${p} || '%'`,
  'starts with': (c, p) => `${c}::text ILIKE ${p} || '%'`,
  'ends with': (c, p) => `${c}::text ILIKE '%' || ${p}`,
  // The parameter is a text[]; comparing as text works for every column type.
  in: (c, p) => `${c}::text = ANY(${p}::text[])`,
  'not in': (c, p) => `NOT (${c}::text = ANY(${p}::text[]))`,
  like: (c, p) => `${c}::text LIKE ${p}`,
  ilike: (c, p) => `${c}::text ILIKE ${p}`,
  'is null': (c) => `${c} IS NULL`,
  'is not null': (c) => `${c} IS NOT NULL`,
};

export const isUnaryOp = (op: FilterOp): boolean => UNARY_OPS.includes(op);
export const isListOp = (op: FilterOp): boolean => LIST_OPS.includes(op);

/** "a, b , c" → ["a", "b", "c"] for IN / NOT IN. */
export const splitList = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
