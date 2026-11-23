import { z } from 'zod';
import { FILTER_OPS } from '../shared/types.js';
import { EXPORT_FORMATS, IMPORT_FORMATS } from '../shared/export.js';
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

/** A JSON-encoded value inside a query-string parameter. */
const jsonParam = <T extends z.ZodType>(inner: T, fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'must be JSON' });
        return z.NEVER;
      }
    })
    .pipe(inner);

const flag = z.enum(['0', '1']).default('0').transform((v) => v === '1');

/** GET /export: everything is in the query string so a plain download link works. */
export const exportQuery = tableRef.extend({
  format: z.enum(EXPORT_FORMATS),
  filters: jsonParam(rowsBody.shape.filters, '[]'),
  match: z.enum(['and', 'or']).default('and'),
  sort: ident.optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

/** POST /import: options in the query string, the raw file is the body. */
export const importQuery = tableRef.extend({
  format: z.enum(IMPORT_FORMATS),
  columns: jsonParam(z.array(ident).min(1).max(1600), '[]'),
  header: flag,
  delimiter: z.string().min(1).max(1).default(','),
  gzip: flag,
  truncate: flag,
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
