import { useEffect, useRef, useState } from 'react';
import type { Cell, Column, TableMeta } from '@shared/types';
import { errorMessage } from './ErrorBox';

interface FieldState {
  text: string;
  isNull: boolean;
  /** Insert only: leave the column out so Postgres applies its default. */
  useDefault: boolean;
}

export interface RowEditorProps {
  meta: TableMeta;
  mode: 'insert' | 'edit';
  /** Current values, for edit mode. */
  row?: Record<string, Cell>;
  focusField?: string;
  onClose: () => void;
  onSave: (values: Record<string, Cell>) => Promise<unknown>;
}

function initialState(col: Column, mode: RowEditorProps['mode'], row?: Record<string, Cell>): FieldState {
  if (mode === 'edit') {
    const v = row?.[col.name] ?? null;
    return { text: v ?? '', isNull: v === null, useDefault: false };
  }
  // Omitting a column with a default, identity, or that accepts NULL is the
  // safest starting point; an empty string would fail for most non-text types.
  return { text: '', isNull: false, useDefault: !!col.default || col.identity || col.nullable };
}

const textRows = (s: string) => Math.min(10, Math.max(1, s.split('\n').length, Math.ceil(s.length / 80)));

export function RowEditor({ meta, mode, row, focusField, onClose, onSave }: RowEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const columns = mode === 'insert' ? meta.columns.filter((c) => !c.generated) : meta.columns;
  const [fields, setFields] = useState<Record<string, FieldState>>(() =>
    Object.fromEntries(columns.map((c) => [c.name, initialState(c, mode, row)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pk = new Set(meta.primaryKey);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const selector = focusField ? `textarea[data-field="${CSS.escape(focusField)}"]:not(:disabled)` : '';
    const target =
      (selector && dialog.querySelector<HTMLTextAreaElement>(selector)) ||
      dialog.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)');
    target?.focus();
  }, [focusField]);

  const isChanged = (name: string) => {
    if (mode !== 'edit') return false;
    const orig = row?.[name] ?? null;
    const st = fields[name]!;
    return st.isNull ? orig !== null : orig === null || st.text !== orig;
  };

  const update = (name: string, patch: Partial<FieldState>) =>
    setFields((f) => ({ ...f, [name]: { ...f[name]!, ...patch } }));

  const submit = async () => {
    const values: Record<string, Cell> = {};
    for (const c of columns) {
      if (c.generated) continue;
      const st = fields[c.name]!;
      if (mode === 'insert' ? !st.useDefault : isChanged(c.name)) values[c.name] = st.isNull ? null : st.text;
    }
    if (mode === 'edit' && !Object.keys(values).length) {
      dialogRef.current?.close();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      dialogRef.current?.close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changedCount = columns.filter((c) => isChanged(c.name)).length;

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="dlg-head">
          <h3>
            {mode === 'insert' ? 'Insert into ' : 'Edit row in '}
            {meta.schema}.{meta.table}
          </h3>
          <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="dlg-body">
          {columns.map((c) => {
            const st = fields[c.name]!;
            const placeholder = st.isNull ? 'NULL' : st.useDefault ? (c.default ?? (c.identity ? 'identity' : 'NULL')) : '';
            return (
              <div key={c.name} className={`field ${isChanged(c.name) ? 'changed' : ''}`}>
                <div className="field-label">
                  <b>{c.name}</b>
                  <span className="t">{c.type}</span>
                  {pk.has(c.name) && <span className="badge warn">PK</span>}
                  {c.generated && <span className="badge">generated</span>}
                  <span className="opts">
                    {mode === 'insert' && (
                      <label>
                        <input
                          type="checkbox"
                          checked={st.useDefault}
                          onChange={(e) => update(c.name, { useDefault: e.target.checked, isNull: false })}
                        />
                        default
                      </label>
                    )}
                    {c.nullable && !c.generated && (
                      <label>
                        <input
                          type="checkbox"
                          checked={st.isNull}
                          onChange={(e) => update(c.name, { isNull: e.target.checked, useDefault: false })}
                        />
                        NULL
                      </label>
                    )}
                  </span>
                </div>
                <textarea
                  data-field={c.name}
                  value={st.isNull ? '' : st.text}
                  placeholder={placeholder}
                  disabled={c.generated || st.isNull}
                  rows={textRows(st.text)}
                  spellCheck={false}
                  onChange={(e) => update(c.name, { text: e.target.value, useDefault: false })}
                />
              </div>
            );
          })}
        </div>

        <div className="dlg-foot">
          {error ? <span className="err">{error}</span> : <span className="hint">⌘/Ctrl + Enter to save</span>}
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving || (mode === 'edit' && !changedCount)}>
            {saving ? 'Saving…' : mode === 'insert' ? 'Insert' : `Save${changedCount ? ` (${changedCount})` : ''}`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
