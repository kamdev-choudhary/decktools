import { z } from 'zod';
import { FILTER_OPS } from '../shared/types.js';
import { EXPORT_FORMATS, IMPORT_FORMATS } from '../shared/export.js';
import { UserError } from '../db/errors.js';
import { FK_ACTIONS } from '../shared/create-table.js';
import { INDEX_METHODS } from '../shared/alter.js';

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

/** GET /dump: database export as one .sql file or a ZIP of per-table files. */
export const dumpQuery = z.object({
  tables: jsonParam(z.array(z.object({ schema: ident, table: ident })).max(10_000), '[]'),
  structure: flag,
  data: flag,
  gzip: flag,
  format: z.enum(['sql', 'zip']).default('sql'),
  dataFormat: z.enum(EXPORT_FORMATS).default('csv'),
});

/** POST /table-action */
export const tableActionBody = z.object({
  schema: ident,
  table: ident,
  action: z.discriminatedUnion('action', [
    z.object({ action: z.literal('truncate'), cascade: z.boolean().default(false), restartIdentity: z.boolean().default(false) }),
    z.object({ action: z.literal('drop'), cascade: z.boolean().default(false) }),
    z.object({ action: z.literal('rename'), newName: ident }),
    z.object({ action: z.literal('duplicate'), newName: ident, withData: z.boolean().default(false) }),
    z.object({ action: z.literal('vacuum'), full: z.boolean().default(false) }),
    z.object({ action: z.literal('analyze') }),
    z.object({ action: z.literal('refresh') }),
  ]),
});

const fkAction = z.enum(FK_ACTIONS);

export const explainBody = z.object({ sql: z.string().min(1).max(1_000_000), analyze: z.boolean().default(false) });

export const statementsQuery = z.object({
  sort: z.enum(['total', 'mean', 'calls', 'rows']).default('total'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const signalBody = z.object({ pid: z.number().int().positive(), terminate: z.boolean().default(false) });

export const objectQuery = z.object({
  kind: z.enum(['function', 'trigger', 'sequence', 'extension']),
  oid: z.coerce.number().int().positive(),
});

const oid = z.number().int().positive();
export const objectActionBody = z.union([
  z.object({ kind: z.literal('function'), oid, action: z.literal('replace'), sql: z.string().min(1).max(1_000_000) }),
  z.object({ kind: z.enum(['function', 'trigger', 'sequence', 'extension']), oid, action: z.literal('drop'), cascade: z.boolean().default(false) }),
  z.object({ kind: z.literal('trigger'), oid, action: z.enum(['enable', 'disable']) }),
  z.object({ kind: z.literal('sequence'), oid, action: z.literal('restart'), value: z.string().min(1).max(40) }),
  z.object({ kind: z.literal('extension'), oid, action: z.literal('update') }),
  z.object({ kind: z.literal('extension'), action: z.literal('create'), name: z.string().min(1).max(63) }),
]);

/** POST /maintenance: ANALYZE / VACUUM many tables. */
export const maintenanceBody = z.object({
  action: z.enum(['analyze', 'vacuum']),
  tables: z.array(tableRef).min(1).max(10_000),
});

/** POST /create-table */
export const createTableBody = z.object({
  schema: ident,
  name: z.string().min(1).max(63),
  comment: z.string().max(10_000).default(''),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(63),
        type: z.string().min(1).max(128),
        nullable: z.boolean().default(true),
        primaryKey: z.boolean().default(false),
        unique: z.boolean().default(false),
        identity: z.boolean().default(false),
        default: z.string().max(10_000).default(''),
        references: z
          .object({ schema: ident, table: ident, column: ident, onDelete: fkAction.default('NO ACTION'), onUpdate: fkAction.default('NO ACTION') })
          .nullable()
          .default(null),
        comment: z.string().max(10_000).default(''),
      }),
    )
    .min(1)
    .max(1600),
});

/** POST /alter: one Structure-tab change. */
export const alterBody = tableRef.extend({
  change: z.discriminatedUnion('action', [
    z.object({ action: z.literal('addColumn'), column: createTableBody.shape.columns.element }),
    z.object({
      action: z.literal('alterColumn'),
      column: ident,
      newName: z.string().max(63).optional(),
      type: z.string().min(1).max(128).optional(),
      using: z.string().max(10_000).optional(),
      nullable: z.boolean().optional(),
      default: z.string().max(10_000).nullable().optional(),
      comment: z.string().max(10_000).nullable().optional(),
    }),
    z.object({ action: z.literal('dropColumn'), column: ident, cascade: z.boolean().default(false) }),
    z.object({
      action: z.literal('createIndex'),
      name: z.string().max(63).default(''),
      columns: z.array(z.object({ name: ident, desc: z.boolean().default(false) })).min(1).max(32),
      unique: z.boolean().default(false),
      method: z.enum(INDEX_METHODS).default('btree'),
      concurrently: z.boolean().default(false),
      where: z.string().max(10_000).default(''),
    }),
    z.object({ action: z.literal('dropIndex'), name: ident, concurrently: z.boolean().default(false), cascade: z.boolean().default(false) }),
    z.object({ action: z.literal('dropConstraint'), name: ident, cascade: z.boolean().default(false) }),
  ]),
});

const dbName = z.string().min(1).max(63);

/** POST /databases */
export const createDatabaseBody = z.object({ name: dbName, template: dbName.optional(), owner: ident.optional() });

/** POST /databases/action */
export const databaseActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), name: dbName, newName: dbName }),
  z.object({ action: z.literal('drop'), name: dbName, force: z.boolean().default(false) }),
]);

/** POST /restore: run an uploaded dump. */
export const restoreQuery = z.object({
  gzip: flag,
  custom: flag,
  single: z.enum(['0', '1']).default('1').transform((v) => v === '1'),
  skipOwnership: z.enum(['0', '1']).default('1').transform((v) => v === '1'),
});

/** POST /import: options in the query string, the raw file is the body. */
export const importQuery = tableRef.extend({
  format: z.enum(IMPORT_FORMATS),
  columns: jsonParam(z.array(ident).min(1).max(1600), '[]'),
  keys: jsonParam(z.array(z.string().max(1024)).max(1600), '[]'),
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
