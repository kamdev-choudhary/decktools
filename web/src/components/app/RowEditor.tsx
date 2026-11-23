import { KeyRound } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Cell, Column, TableMeta } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage, Kbd, Spinner } from './feedback';

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

export function RowEditor({ meta, mode, row, focusField, onClose, onSave }: RowEditorProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const columns = mode === 'insert' ? meta.columns.filter((c) => !c.generated) : meta.columns;
  const [fields, setFields] = useState<Record<string, FieldState>>(() =>
    Object.fromEntries(columns.map((c) => [c.name, initialState(c, mode, row)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pk = new Set(meta.primaryKey);

  const isChanged = (name: string) => {
    if (mode !== 'edit') return false;
    const orig = row?.[name] ?? null;
    const st = fields[name]!;
    return st.isNull ? orig !== null : orig === null || st.text !== orig;
  };
  const changedCount = columns.filter((c) => isChanged(c.name)).length;

  const update = (name: string, patch: Partial<FieldState>) => setFields((f) => ({ ...f, [name]: { ...f[name]!, ...patch } }));

  const submit = async () => {
    const values: Record<string, Cell> = {};
    for (const c of columns) {
      if (c.generated) continue;
      const st = fields[c.name]!;
      if (mode === 'insert' ? !st.useDefault : isChanged(c.name)) values[c.name] = st.isNull ? null : st.text;
    }
    if (mode === 'edit' && !Object.keys(values).length) return onClose();
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 p-0 sm:max-w-2xl"
        onOpenAutoFocus={(e) => {
          // Focus the cell that was double-clicked rather than the first control.
          e.preventDefault();
          const body = bodyRef.current;
          const selector = focusField ? `textarea[data-field="${CSS.escape(focusField)}"]:not(:disabled)` : '';
          ((selector && body?.querySelector<HTMLTextAreaElement>(selector)) || body?.querySelector('textarea:not(:disabled)'))?.focus();
        }}
      >
        <form
          className="flex min-h-0 flex-col"
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
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{mode === 'insert' ? 'Insert row' : 'Edit row'}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {meta.schema}.{meta.table}
            </DialogDescription>
          </DialogHeader>

          <div ref={bodyRef} className="min-h-0 flex-1 divide-y overflow-y-auto px-6">
            {columns.map((c) => {
              const st = fields[c.name]!;
              const placeholder = st.isNull ? 'NULL' : st.useDefault ? (c.default ?? (c.identity ? 'identity' : 'NULL')) : '';
              const id = `field-${c.name}`;
              return (
                <div key={c.name} className="space-y-2 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id} className="font-mono text-[13px]">
                      {pk.has(c.name) && <KeyRound className="size-3 text-warning" />}
                      {c.name}
                    </Label>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.type}</span>
                    {c.generated && <Badge variant="secondary">generated</Badge>}
                    {isChanged(c.name) && (
                      <Badge variant="outline" className="border-warning/40 text-warning">
                        modified
                      </Badge>
                    )}
                    <div className="ml-auto flex items-center gap-4">
                      {mode === 'insert' && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={st.useDefault}
                            onCheckedChange={(v) => update(c.name, { useDefault: v === true, isNull: false })}
                          />
                          Default
                        </label>
                      )}
                      {c.nullable && !c.generated && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={st.isNull}
                            onCheckedChange={(v) => update(c.name, { isNull: v === true, useDefault: false })}
                          />
                          NULL
                        </label>
                      )}
                    </div>
                  </div>
                  <Textarea
                    id={id}
                    data-field={c.name}
                    value={st.isNull ? '' : st.text}
                    placeholder={placeholder}
                    disabled={c.generated || st.isNull}
                    spellCheck={false}
                    onChange={(e) => update(c.name, { text: e.target.value, useDefault: false })}
                    className={cn(
                      'max-h-60 min-h-9 font-mono text-[13px]',
                      isChanged(c.name) && 'border-warning/60 focus-visible:border-warning',
                    )}
                  />
                </div>
              );
            })}
          </div>

          <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
            {error ? (
              <p className="max-h-24 overflow-auto font-mono text-xs whitespace-pre-wrap text-destructive">{error}</p>
            ) : (
              <p className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                <Kbd>⌘</Kbd>
                <Kbd>Enter</Kbd> to save
              </p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || (mode === 'edit' && !changedCount)}>
                {saving && <Spinner className="text-current" />}
                {mode === 'insert' ? 'Insert row' : changedCount ? `Save ${changedCount} change${changedCount > 1 ? 's' : ''}` : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
