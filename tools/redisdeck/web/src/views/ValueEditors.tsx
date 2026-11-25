import { ArrowDownToLine, ArrowUpToLine, Braces, Pencil, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { KeyAction, KeyDetail, KeyValue, RText } from '@shared/types';
import { Button } from '@deck/ui/components/button';
import { Textarea } from '@deck/ui/components/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { cn } from '@deck/ui/lib/utils';
import { api } from '@/api/client';
import { useKeyAction } from '@/api/hooks';
import { errorMessage, Spinner } from '@/components/feedback';
import { FormDialog, type Field } from '@/components/FormDialog';
import { formatNumber } from '@/lib/format';

const PAGE = 200;

/* ------------------------------------------------------------------ */
/* Paging                                                              */
/* ------------------------------------------------------------------ */

function nextPage(v: KeyValue, loaded: number, length: number): { cursor?: string; offset?: number } | null {
  switch (v.type) {
    case 'hash':
    case 'set':
      return v.cursor !== '0' ? { cursor: v.cursor } : null;
    case 'list':
    case 'zset':
      return loaded < length ? { offset: v.offset + PAGE } : null;
    case 'stream':
      return v.next ? { cursor: v.next } : null;
    default:
      return null;
  }
}

const count = (v: KeyValue) =>
  v.type === 'hash' || v.type === 'stream' ? v.entries.length : v.type === 'list' ? v.items.length : v.type === 'set' || v.type === 'zset' ? v.members.length : 0;

/** The first page comes with the key; "Load more" appends the following ones. */
function usePages(db: number, detail: KeyDetail) {
  const [pages, setPages] = useState<KeyValue[]>([detail.value]);
  const [pagesFor, setPagesFor] = useState(detail);
  if (pagesFor !== detail) {
    setPagesFor(detail);
    setPages([detail.value]);
  }
  const [loading, setLoading] = useState(false);
  const loaded = pages.reduce((n, p) => n + count(p), 0);
  const next = nextPage(pages.at(-1)!, loaded, detail.length);

  const loadMore = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const d = await api.key(db, detail.id, next);
      setPages((p) => [...p, d.value]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return { pages, loaded, hasMore: !!next, loadMore, loading };
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/** Run a key action with a toast; resolves true on success. */
function useRun(db: number) {
  const action = useKeyAction(db);
  const run = (a: KeyAction, after?: () => void) =>
    action.mutate(a, {
      onSuccess: (res) => {
        toast.success(res.message);
        after?.();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  return { run, action };
}

function Value({ v, className }: { v: RText; className?: string }) {
  return (
    <span className={cn('block truncate', v.binary && 'text-muted-foreground italic', className)} title={v.text.length > 60 ? v.text.slice(0, 4000) : undefined}>
      {v.text === '' ? <span className="text-null italic">(empty)</span> : v.text}
    </span>
  );
}

function RowActions({ onEdit, onDelete, disabled, binary }: { onEdit?: () => void; onDelete: () => void; disabled: boolean; binary?: boolean }) {
  if (disabled) return null;
  if (binary)
    return (
      <span className="text-[11px] text-muted-foreground" title="Binary data can't be edited in the browser; use the console">
        binary
      </span>
    );
  return (
    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {onEdit && (
        <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit">
          <Pencil />
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label="Delete" className="hover:text-destructive">
        <Trash2 />
      </Button>
    </div>
  );
}

/** A grid in the same style as pgdeck's data grid: sticky header, mono cells, hover rows. */
function Grid({ columns, children, footer }: { columns: { label: string; className?: string }[]; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={cn('border-b bg-grid-header px-3 py-2 text-left text-xs font-medium text-muted-foreground', c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-[12.5px]">{children}</tbody>
      </table>
      {footer}
    </div>
  );
}

const cell = 'border-b px-3 py-2 align-top group-hover:bg-row-hover';

function LoadMore({ pages, total }: { pages: ReturnType<typeof usePages>; total: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-muted-foreground">
      <span className="tabular-nums">
        Showing {formatNumber(Math.min(pages.loaded, total))} of {formatNumber(total)}
      </span>
      {pages.hasMore && (
        <Button variant="outline" size="sm" onClick={() => void pages.loadMore()} disabled={pages.loading}>
          {pages.loading && <Spinner />} Load {formatNumber(Math.min(PAGE, total - pages.loaded))} more
        </Button>
      )}
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">{children}</div>;
}

type DialogState = { title: string; fields: Field[]; submit: string; onSubmit: (v: Record<string, string>) => KeyAction } | null;

/** One dialog per editor, configured per use (add / edit). */
function useEditDialog(db: number) {
  const { run, action } = useRun(db);
  const [state, setState] = useState<DialogState>(null);
  const dialog = (
    <FormDialog
      open={!!state}
      onOpenChange={(o) => {
        if (!o) setState(null);
        action.reset();
      }}
      title={state?.title ?? ''}
      fields={state?.fields ?? []}
      submitLabel={state?.submit ?? 'Save'}
      pending={action.isPending}
      error={action.error}
      onSubmit={(v) => {
        try {
          run(state!.onSubmit(v), () => setState(null));
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
    />
  );
  return { open: setState, dialog, run };
}

interface EditorProps {
  db: number;
  detail: KeyDetail;
  readonly: boolean;
}

/* ------------------------------------------------------------------ */
/* String                                                              */
/* ------------------------------------------------------------------ */

function prettyJson(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

export function StringEditor({ db, detail, readonly }: EditorProps) {
  if (detail.value.type !== 'string') return null;
  const v = detail.value;
  const locked = readonly || v.truncated || !!v.value.binary;
  return <StringBody key={`${detail.id}:${v.value.text.length}:${v.value.text.slice(0, 64)}`} db={db} id={detail.id} initial={v.value.text} locked={locked} note={v.truncated ? `Showing the first 256 kB of ${formatNumber(detail.length)} bytes. Large values are read-only here.` : v.value.binary ? 'Binary value, shown escaped (\\xHH). Edit it from the console.' : null} />;
}

function StringBody({ db, id, initial, locked, note }: { db: number; id: string; initial: string; locked: boolean; note: string | null }) {
  const [text, setText] = useState(initial);
  const { run, action } = useRun(db);
  const dirty = text !== initial;
  const pretty = prettyJson(text);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        <span className="text-xs text-muted-foreground">{note ?? (pretty ? 'Looks like JSON.' : 'Plain text.')}</span>
        <div className="flex-1" />
        {pretty && pretty !== text && !locked && (
          <Button variant="ghost" size="sm" onClick={() => setText(pretty)}>
            <Braces /> Format JSON
          </Button>
        )}
        {!locked && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setText(initial)} disabled={!dirty}>
              <Undo2 /> Revert
            </Button>
            <Button size="sm" onClick={() => run({ op: 'string.set', id, value: text })} disabled={!dirty || action.isPending}>
              {action.isPending ? <Spinner className="text-current" /> : <Save />} Save
            </Button>
          </>
        )}
      </Toolbar>
      <Textarea
        value={text}
        readOnly={locked}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (dirty && !locked) run({ op: 'string.set', id, value: text });
          }
        }}
        spellCheck={false}
        aria-label="Value"
        className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-[12.5px] leading-relaxed shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hash                                                                */
/* ------------------------------------------------------------------ */

export function HashEditor({ db, detail, readonly }: EditorProps) {
  const pages = usePages(db, detail);
  const { open, dialog, run } = useEditDialog(db);
  const seen = new Set<string>();
  const entries = pages.pages.flatMap((p) => (p.type === 'hash' ? p.entries : [])).filter((e) => !seen.has(e.field.text) && !!seen.add(e.field.text));
  const id = detail.id;

  const edit = (field?: string, value?: string) =>
    open({
      title: field === undefined ? 'Add field' : 'Edit field',
      fields: [
        { name: 'field', label: 'Field', initial: field, required: true },
        { name: 'value', label: 'Value', initial: value, multiline: true },
      ],
      submit: field === undefined ? 'Add field' : 'Save',
      onSubmit: (v) => ({ op: 'hash.set', id, field: v.field!, value: v.value!, previousField: field }),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readonly && (
        <Toolbar>
          <Button variant="outline" size="sm" onClick={() => edit()}>
            <Plus /> Add field
          </Button>
        </Toolbar>
      )}
      <Grid columns={[{ label: 'Field', className: 'w-[35%]' }, { label: 'Value' }, { label: '', className: 'w-20' }]} footer={<LoadMore pages={pages} total={detail.length} />}>
        {entries.map((e) => (
          <tr key={e.field.text} className="group">
            <td className={cn(cell, 'font-medium')}>
              <Value v={e.field} />
            </td>
            <td className={cell}>
              <Value v={e.value} />
            </td>
            <td className={cell}>
              <RowActions
                disabled={readonly}
                binary={e.field.binary || e.value.binary}
                onEdit={() => edit(e.field.text, e.value.text)}
                onDelete={() => run({ op: 'hash.delete', id, fields: [e.field.text] })}
              />
            </td>
          </tr>
        ))}
      </Grid>
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export function ListEditor({ db, detail, readonly }: EditorProps) {
  const pages = usePages(db, detail);
  const { open, dialog, run } = useEditDialog(db);
  const items = pages.pages.flatMap((p) => (p.type === 'list' ? p.items : []));
  const id = detail.id;

  const push = (end: 'head' | 'tail') =>
    open({
      title: end === 'head' ? 'Add to the head' : 'Add to the tail',
      fields: [{ name: 'value', label: 'Value', multiline: true }],
      submit: 'Add',
      onSubmit: (v) => ({ op: 'list.push', id, value: v.value!, end }),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readonly && (
        <Toolbar>
          <Button variant="outline" size="sm" onClick={() => push('head')}>
            <ArrowUpToLine /> Add to head
          </Button>
          <Button variant="outline" size="sm" onClick={() => push('tail')}>
            <ArrowDownToLine /> Add to tail
          </Button>
        </Toolbar>
      )}
      <Grid columns={[{ label: 'Index', className: 'w-20 text-right' }, { label: 'Value' }, { label: '', className: 'w-20' }]} footer={<LoadMore pages={pages} total={detail.length} />}>
        {items.map((item) => (
          <tr key={item.index} className="group">
            <td className={cn(cell, 'text-right text-muted-foreground tabular-nums')}>{item.index}</td>
            <td className={cell}>
              <Value v={item.value} />
            </td>
            <td className={cell}>
              <RowActions
                disabled={readonly}
                binary={item.value.binary}
                onEdit={() =>
                  open({
                    title: `Edit element ${item.index}`,
                    fields: [{ name: 'value', label: 'Value', initial: item.value.text, multiline: true }],
                    submit: 'Save',
                    onSubmit: (v) => ({ op: 'list.set', id, index: item.index, value: v.value! }),
                  })
                }
                onDelete={() => run({ op: 'list.delete', id, index: item.index })}
              />
            </td>
          </tr>
        ))}
      </Grid>
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Set                                                                 */
/* ------------------------------------------------------------------ */

export function SetEditor({ db, detail, readonly }: EditorProps) {
  const pages = usePages(db, detail);
  const { open, dialog, run } = useEditDialog(db);
  const seen = new Set<string>();
  const members = pages.pages.flatMap((p) => (p.type === 'set' ? p.members : [])).filter((m) => !seen.has(m.text) && !!seen.add(m.text));
  const id = detail.id;

  const edit = (previous?: string) =>
    open({
      title: previous === undefined ? 'Add member' : 'Edit member',
      fields: [{ name: 'member', label: 'Member', initial: previous, multiline: true }],
      submit: previous === undefined ? 'Add member' : 'Save',
      onSubmit: (v) => ({ op: 'set.add', id, member: v.member!, previous }),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readonly && (
        <Toolbar>
          <Button variant="outline" size="sm" onClick={() => edit()}>
            <Plus /> Add member
          </Button>
        </Toolbar>
      )}
      <Grid columns={[{ label: 'Member' }, { label: '', className: 'w-20' }]} footer={<LoadMore pages={pages} total={detail.length} />}>
        {members.map((m) => (
          <tr key={m.text} className="group">
            <td className={cell}>
              <Value v={m} />
            </td>
            <td className={cell}>
              <RowActions disabled={readonly} binary={m.binary} onEdit={() => edit(m.text)} onDelete={() => run({ op: 'set.delete', id, members: [m.text] })} />
            </td>
          </tr>
        ))}
      </Grid>
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sorted set                                                          */
/* ------------------------------------------------------------------ */

export function ZSetEditor({ db, detail, readonly }: EditorProps) {
  const pages = usePages(db, detail);
  const { open, dialog, run } = useEditDialog(db);
  const members = pages.pages.flatMap((p) => (p.type === 'zset' ? p.members.map((m, i) => ({ ...m, rank: p.offset + i })) : []));
  const id = detail.id;

  const edit = (previous?: string, score?: string) =>
    open({
      title: previous === undefined ? 'Add member' : 'Edit member',
      fields: [
        { name: 'score', label: 'Score', initial: score ?? '0', type: 'number', required: true },
        { name: 'member', label: 'Member', initial: previous, multiline: true },
      ],
      submit: previous === undefined ? 'Add member' : 'Save',
      onSubmit: (v) => {
        const s = Number(v.score);
        if (!Number.isFinite(s)) throw new Error('Score must be a number');
        return { op: 'zset.add', id, member: v.member!, score: s, previous };
      },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readonly && (
        <Toolbar>
          <Button variant="outline" size="sm" onClick={() => edit()}>
            <Plus /> Add member
          </Button>
        </Toolbar>
      )}
      <Grid
        columns={[{ label: 'Rank', className: 'w-16 text-right' }, { label: 'Score', className: 'w-36 text-right' }, { label: 'Member' }, { label: '', className: 'w-20' }]}
        footer={<LoadMore pages={pages} total={detail.length} />}
      >
        {members.map((m) => (
          <tr key={m.member.text} className="group">
            <td className={cn(cell, 'text-right text-muted-foreground tabular-nums')}>{m.rank}</td>
            <td className={cn(cell, 'text-right tabular-nums')}>{m.score}</td>
            <td className={cell}>
              <Value v={m.member} />
            </td>
            <td className={cell}>
              <RowActions disabled={readonly} binary={m.member.binary} onEdit={() => edit(m.member.text, m.score)} onDelete={() => run({ op: 'zset.delete', id, members: [m.member.text] })} />
            </td>
          </tr>
        ))}
      </Grid>
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stream                                                              */
/* ------------------------------------------------------------------ */

/** "field value" per line → { field: value }. */
function parseFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const i = t.search(/\s/);
    if (i < 0) throw new Error(`Line "${t}" needs a field and a value, separated by a space`);
    out[t.slice(0, i)] = t.slice(i).trim();
  }
  if (!Object.keys(out).length) throw new Error('Add at least one "field value" line');
  return out;
}

export function StreamEditor({ db, detail, readonly }: EditorProps) {
  const pages = usePages(db, detail);
  const { open, dialog, run } = useEditDialog(db);
  const entries = pages.pages.flatMap((p) => (p.type === 'stream' ? p.entries : []));
  const id = detail.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        <span className="text-xs text-muted-foreground">Newest entries first.</span>
        <div className="flex-1" />
        {!readonly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              open({
                title: 'Add entry',
                fields: [{ name: 'fields', label: 'Fields', multiline: true, placeholder: 'event signup\nuser 42', hint: 'One "field value" per line. The entry gets an automatic id (*).' }],
                submit: 'Add entry',
                onSubmit: (v) => ({ op: 'stream.add', id, fields: parseFields(v.fields!) }),
              })
            }
          >
            <Plus /> Add entry
          </Button>
        )}
      </Toolbar>
      <Grid columns={[{ label: 'Entry id', className: 'w-48' }, { label: 'Fields' }, { label: '', className: 'w-14' }]} footer={<LoadMore pages={pages} total={detail.length} />}>
        {entries.map((e) => (
          <tr key={e.id} className="group">
            <td className={cn(cell, 'text-muted-foreground tabular-nums')}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default">{e.id}</span>
                </TooltipTrigger>
                <TooltipContent>{new Date(Number(e.id.split('-')[0])).toLocaleString()}</TooltipContent>
              </Tooltip>
            </td>
            <td className={cell}>
              <div className="flex flex-wrap gap-1.5">
                {e.fields.map((f, i) => (
                  <span key={i} className="inline-flex max-w-full items-center overflow-hidden rounded border bg-muted/40">
                    <span className="border-r px-1.5 py-0.5 text-muted-foreground">{f.field.text}</span>
                    <span className="truncate px-1.5 py-0.5" title={f.value.text}>
                      {f.value.text}
                    </span>
                  </span>
                ))}
              </div>
            </td>
            <td className={cell}>
              <RowActions disabled={readonly} onDelete={() => run({ op: 'stream.delete', id, entryIds: [e.id] })} />
            </td>
          </tr>
        ))}
      </Grid>
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* JSON (RedisJSON)                                                    */
/* ------------------------------------------------------------------ */

export function JsonEditor({ db, detail, readonly }: EditorProps) {
  if (detail.value.type !== 'ReJSON-RL') return null;
  const json = detail.value.json;
  return <JsonBody key={json} db={db} id={detail.id} initial={prettyJson(json) ?? json} readonly={readonly} />;
}

function JsonBody({ db, id, initial, readonly }: { db: number; id: string; initial: string; readonly: boolean }) {
  const [text, setText] = useState(initial);
  const { run, action } = useRun(db);
  const valid = (() => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  })();
  const dirty = text !== initial;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        <span className={cn('text-xs', valid ? 'text-muted-foreground' : 'text-destructive')}>{valid ? 'Valid JSON.' : 'Not valid JSON yet.'}</span>
        <div className="flex-1" />
        {!readonly && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setText(initial)} disabled={!dirty}>
              <Undo2 /> Revert
            </Button>
            <Button size="sm" onClick={() => run({ op: 'json.set', id, json: text })} disabled={!dirty || !valid || action.isPending}>
              {action.isPending ? <Spinner className="text-current" /> : <Save />} Save
            </Button>
          </>
        )}
      </Toolbar>
      <Textarea
        value={text}
        readOnly={readonly}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="JSON value"
        className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-[12.5px] leading-relaxed shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
