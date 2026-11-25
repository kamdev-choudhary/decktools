/**
 * ALTER TABLE / CREATE INDEX statements for the Structure tab. Shared so the UI
 * previews exactly what the server runs.
 */
import {
  columnDefinition,
  foreignKeyClause,
  isValidType,
  quoteIdent,
  quoteLiteral,
  validateColumn,
  type NewColumn,
} from './create-table.js';

export const INDEX_METHODS = ['btree', 'hash', 'gin', 'gist', 'brin', 'spgist'] as const;
export type IndexMethod = (typeof INDEX_METHODS)[number];

export type AlterAction =
  | { action: 'addColumn'; column: NewColumn }
  | {
      action: 'alterColumn';
      column: string;
      newName?: string;
      type?: string;
      /** USING expression for the type change, e.g. `status::int`. */
      using?: string;
      nullable?: boolean;
      /** A SQL expression; null drops the default. Omit to leave it. */
      default?: string | null;
      /** Null removes the comment. Omit to leave it. */
      comment?: string | null;
    }
  | { action: 'dropColumn'; column: string; cascade: boolean }
  | {
      action: 'createIndex';
      /** Empty lets Postgres pick a name. */
      name: string;
      columns: { name: string; desc: boolean }[];
      unique: boolean;
      method: IndexMethod;
      concurrently: boolean;
      /** Partial index predicate; empty for none. */
      where: string;
    }
  | { action: 'dropIndex'; name: string; concurrently: boolean; cascade: boolean }
  | { action: 'dropConstraint'; name: string; cascade: boolean };

/** Statements that must run outside a transaction block. */
export const runsOutsideTransaction = (a: AlterAction): boolean =>
  (a.action === 'createIndex' || a.action === 'dropIndex') && a.concurrently;

export function validateAlter(a: AlterAction): string[] {
  switch (a.action) {
    case 'addColumn':
      return validateColumn(a.column, 'Column');
    case 'alterColumn': {
      const e: string[] = [];
      if (a.newName !== undefined && !a.newName.trim()) e.push('The column needs a name.');
      if (a.newName && a.newName.length > 63) e.push('Names are limited to 63 characters.');
      if (a.type !== undefined && !isValidType(a.type)) e.push(`"${a.type}" is not a valid type.`);
      return e;
    }
    case 'createIndex': {
      const e: string[] = [];
      if (!a.columns.length) e.push('Pick at least one column.');
      if (a.name.length > 63) e.push('Names are limited to 63 characters.');
      if (a.unique && a.method !== 'btree') e.push('Only btree indexes can be unique.');
      return e;
    }
    default:
      return [];
  }
}

/** The statements for one change, in the order they must run. */
export function alterSql(schema: string, table: string, a: AlterAction): string[] {
  const rel = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const alter = (clause: string) => `ALTER TABLE ${rel} ${clause};`;

  switch (a.action) {
    case 'addColumn': {
      const c = a.column;
      const out = [alter(`ADD COLUMN ${columnDefinition(c, c.primaryKey)}`)];
      if (c.references) out.push(alter(`ADD ${foreignKeyClause(c.name, c.references)}`));
      if (c.comment.trim())
        out.push(`COMMENT ON COLUMN ${rel}.${quoteIdent(c.name)} IS ${quoteLiteral(c.comment.trim())};`);
      return out;
    }
    case 'alterColumn': {
      const col = quoteIdent(a.column);
      const out: string[] = [];
      const clauses: string[] = [];
      if (a.type !== undefined) {
        // An old default that can't be cast would block the type change: drop it first,
        // change the type, then set the (new) default. Callers pass `default` along with `type`.
        out.push(alter(`ALTER COLUMN ${col} DROP DEFAULT`));
        out.push(
          alter(`ALTER COLUMN ${col} TYPE ${a.type.trim()}${a.using?.trim() ? ` USING ${a.using.trim()}` : ''}`),
        );
        if (a.default?.trim()) clauses.push(`ALTER COLUMN ${col} SET DEFAULT ${a.default.trim()}`);
      } else if (a.default !== undefined) {
        clauses.push(
          a.default === null || !a.default.trim()
            ? `ALTER COLUMN ${col} DROP DEFAULT`
            : `ALTER COLUMN ${col} SET DEFAULT ${a.default.trim()}`,
        );
      }
      if (a.nullable !== undefined) clauses.push(`ALTER COLUMN ${col} ${a.nullable ? 'DROP' : 'SET'} NOT NULL`);
      if (clauses.length) out.push(`ALTER TABLE ${rel}\n  ${clauses.join(',\n  ')};`);
      if (a.comment !== undefined)
        out.push(`COMMENT ON COLUMN ${rel}.${col} IS ${a.comment?.trim() ? quoteLiteral(a.comment.trim()) : 'NULL'};`);
      // RENAME can't be combined with other subcommands; do it last.
      if (a.newName !== undefined && a.newName !== a.column)
        out.push(alter(`RENAME COLUMN ${col} TO ${quoteIdent(a.newName)}`));
      return out;
    }
    case 'dropColumn':
      return [alter(`DROP COLUMN ${quoteIdent(a.column)}${a.cascade ? ' CASCADE' : ''}`)];
    case 'createIndex': {
      const cols = a.columns.map((c) => `${quoteIdent(c.name)}${c.desc ? ' DESC' : ''}`).join(', ');
      return [
        `CREATE ${a.unique ? 'UNIQUE ' : ''}INDEX ${a.concurrently ? 'CONCURRENTLY ' : ''}${a.name.trim() ? `${quoteIdent(a.name.trim())} ` : ''}ON ${rel}` +
          `${a.method !== 'btree' ? ` USING ${a.method}` : ''} (${cols})${a.where.trim() ? ` WHERE ${a.where.trim()}` : ''};`,
      ];
    }
    case 'dropIndex':
      return [
        `DROP INDEX ${a.concurrently ? 'CONCURRENTLY ' : ''}${quoteIdent(schema)}.${quoteIdent(a.name)}${a.cascade && !a.concurrently ? ' CASCADE' : ''};`,
      ];
    case 'dropConstraint':
      return [alter(`DROP CONSTRAINT ${quoteIdent(a.name)}${a.cascade ? ' CASCADE' : ''}`)];
  }
}
