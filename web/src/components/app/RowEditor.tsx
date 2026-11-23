import { KeyRound } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Cell, Column, TableMeta } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { errorMessage, Kbd, Spinner } from './feedback';
import { FieldInput } from './FieldInput';
import { TruncatedText } from './TruncatedText';

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

/** Small on/off button for NULL / Default, sized to sit beside a 36px input. */
function ToggleChip({ pressed, onToggle, title, children }: { pressed: boolean; onToggle: (on: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onToggle(!pressed)}
      className={
        'h-9 shrink-0 rounded-md border px-2.5 font-mono text-[11px] transition-colors ' +
        (pressed ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')
      }
    >
      {children}
    </button>
  );
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
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onOpenAutoFocus={(e) => {
          // Focus the cell that was double-clicked rather than the first control.
          e.preventDefault();
          const body = bodyRef.current;
          const selector = focusField ? `[data-field="${CSS.escape(focusField)}"]:not(:disabled)` : '';
          ((selector && body?.querySelector<HTMLElement>(selector)) || body?.querySelector<HTMLElement>('[data-field]:not(:disabled)'))?.focus();
        }}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
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
                <div
                  key={c.name}
                  className="grid gap-x-5 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-start"
                >
                  {/* Left: name, type, flags */}
                  <div className="min-w-0 sm:pt-1.5">
                    <Label id={`${id}-label`} htmlFor={id} className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
                      {pk.has(c.name) && <KeyRound className="size-3 shrink-0 text-warning" aria-label="Primary key" />}
                      <TruncatedText text={c.name} side="left" />
                    </Label>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <TruncatedText text={c.type} side="left" className="font-mono text-[11px] text-muted-foreground" />
                      {c.generated && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          generated
                        </Badge>
                      )}
                      {isChanged(c.name) && (
                        <Badge variant="outline" className="border-warning/40 px-1.5 py-0 text-[10px] text-warning">
                          modified
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Right: the editor, with NULL / Default toggles beside it */}
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <FieldInput
                        id={id}
                        column={c}
                        value={st.isNull ? '' : st.text}
                        placeholder={placeholder}
                        disabled={c.generated || st.isNull}
                        changed={isChanged(c.name)}
                        onChange={(text) => update(c.name, { text, useDefault: false })}
                      />
                    </div>
                    {mode === 'insert' && !c.generated && (
                      <ToggleChip
                        pressed={st.useDefault}
                        onToggle={(on) => update(c.name, { useDefault: on, isNull: false })}
                        title={c.default ? `Use default: ${c.default}` : 'Leave out so Postgres applies its default'}
                      >
                        Default
                      </ToggleChip>
                    )}
                    {c.nullable && !c.generated && (
                      <ToggleChip pressed={st.isNull} onToggle={(on) => update(c.name, { isNull: on, useDefault: false })} title="Set to NULL">
                        NULL
                      </ToggleChip>
                    )}
                  </div>
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
