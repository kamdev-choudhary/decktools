import { navigate, sqlHref } from './router';
import { storage } from './storage';

export const draftKey = (db: string) => `pgdeck.sql.draft.${db}`;
export const autoExplainKey = (db: string) => `pgdeck.sql.autoExplain.${db}`;

/** Put SQL into the editor for a database and open it, optionally explaining it right away. */
export function openInSqlEditor(db: string, sql: string, opts: { explain?: boolean } = {}): void {
  storage.set(draftKey(db), sql);
  if (opts.explain) storage.set(autoExplainKey(db), '1');
  navigate(sqlHref(db));
}
