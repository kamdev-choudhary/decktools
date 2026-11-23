import { z } from 'zod';
import { FILTER_OPS } from '../shared/types.js';
import { UserError } from '../db/errors.js';

const ident = z.string().min(1).max(256);
const cell = z.string().nullable();
const cellRecord = z.record(z.string(), cell);

const tableRef = z.object({ schema: ident, table: ident });

export const metaQuery = tableRef;

export const rowsBody = tableRef.extend({
  limit: z.number().int().min(1).max(100_000).default(100),
  offset: z.number().int().min(0).default(0),
  sort: ident.optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  filters: z
    .array(z.object({ col: ident, op: z.enum(FILTER_OPS), val: z.string().optional() }))
    .max(50)
    .default([]),
  match: z.enum(['and', 'or']).default('and'),
});

export const insertBody = tableRef.extend({ values: cellRecord });

export const updateBody = tableRef.extend({ key: cellRecord, values: cellRecord });

export const deleteBody = tableRef.extend({ keys: z.array(cellRecord).min(1).max(10_000) });

export const queryBody = z.object({ sql: z.string().min(1).max(5_000_000) });

/** Validate input, turning schema failures into a 400 the UI can display. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new UserError(`Invalid request: ${z.prettifyError(result.error)}`);
  return result.data;
}
