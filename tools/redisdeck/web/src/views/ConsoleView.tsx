import { Braces, Copy, CornerDownLeft, Eraser, Pencil, RotateCw, TriangleAlert } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CommandDoc, Reply } from '@shared/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@deck/ui/components/alert-dialog';
import { Button } from '@deck/ui/components/button';
import { Switch } from '@deck/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { storage } from '@deck/ui/lib/storage';
import { cn } from '@deck/ui/lib/utils';
import { useCommand, useCommandDocs } from '@/api/hooks';
import { errorMessage, Kbd, Spinner } from '@/components/feedback';
import { caretLine, commandsIn, complete, danger, docForLine, prettyJson, replySize, replyToText } from '@/lib/console';

const HISTORY_KEY = 'redisdeck.history';
const RAW_KEY = 'redisdeck.console.raw';
const HISTORY_MAX = 200;
/** Array elements rendered before "Show all". */
const ARRAY_PREVIEW = 100;

interface Entry {
  n: number;
  db: number;
  command: string;
  reply?: Reply;
  error?: string;
  ms?: number;
}

/** Transcripts per database, kept while the page is open so switching views doesn't lose them. */
const transcripts = new Map<number, Entry[]>();
let counter = 0;

/* ------------------------------------------------------------------ */
/* Replies                                                             */
/* ------------------------------------------------------------------ */

function StringReply({ text, binary, raw }: { text: string; binary?: boolean; raw: boolean }) {
  const pretty = binary ? null : prettyJson(text);
  const [formatted, setFormatted] = useState(false);
  if (formatted && pretty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setFormatted(false)}
          className="mb-1 inline-flex items-center gap-1 font-sans text-[11px] text-link hover:underline"
        >
          <Braces className="size-3" /> Show as stored
        </button>
        <pre className="rounded-md border bg-background p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
          {pretty}
        </pre>
      </div>
    );
  }
  return (
    <span className="break-all whitespace-pre-wrap" title={binary ? 'Binary value, shown escaped (\\xHH)' : undefined}>
      {raw ? text : `"${text}"`}
      {pretty && (
        <button
          type="button"
          onClick={() => setFormatted(true)}
          className="ml-2 inline-flex items-center gap-1 align-middle font-sans text-[11px] text-link hover:underline"
        >
          <Braces className="size-3" /> Format JSON
        </button>
      )}
    </span>
  );
}

function ArrayReply({ items, raw }: { items: Reply[]; raw: boolean }) {
  const [all, setAll] = useState(items.length <= ARRAY_PREVIEW);
  const shown = all ? items : items.slice(0, ARRAY_PREVIEW);
  const width = String(items.length).length;
  return (
    <div>
      {shown.map((item, i) =>
        raw ? (
          <div key={i}>
            <ReplyView reply={item} raw />
          </div>
        ) : (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 whitespace-pre text-muted-foreground tabular-nums select-none">{`${String(i + 1).padStart(width)})`}</span>
            <div className="min-w-0">
              <ReplyView reply={item} raw={false} />
            </div>
          </div>
        ),
      )}
      {!all && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 font-sans text-xs text-link hover:underline">
          Show all {items.length.toLocaleString()} elements
        </button>
      )}
    </div>
  );
}

/** A reply rendered the way redis-cli prints it (or `redis-cli --raw`). */
function ReplyView({ reply, raw }: { reply: Reply; raw: boolean }): ReactNode {
  switch (reply.kind) {
    case 'nil':
      return raw ? null : <span className="text-muted-foreground">(nil)</span>;
    case 'integer':
      return raw ? (
        <span>{reply.value}</span>
      ) : (
        <span>
          <span className="text-muted-foreground">(integer)</span> {reply.value}
        </span>
      );
    case 'status':
      return <span>{reply.value}</span>;
    case 'error':
      return <span className="text-destructive">(error) {reply.value}</span>;
    case 'string':
      return <StringReply text={reply.value.text} binary={reply.value.binary} raw={raw} />;
    case 'array':
      return reply.items.length ? (
        <ArrayReply items={reply.items} raw={raw} />
      ) : raw ? null : (
        <span className="text-muted-foreground">(empty array)</span>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Input help                                                          */
/* ------------------------------------------------------------------ */

const upper = (name: string) => name.toUpperCase();

function Signature({ doc }: { doc: CommandDoc }) {
  const writes = doc.flags.includes('write');
  return (
    <div className="space-y-1">
      <div className="font-mono text-[12.5px]">
        <span className="font-semibold">{upper(doc.name)}</span>{' '}
        <span className="text-muted-foreground">{doc.syntax}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {doc.summary && <span>{doc.summary}</span>}
        {doc.group && <span className="rounded border px-1.5 font-mono text-[10.5px]">{doc.group}</span>}
        {writes && <span className="rounded border border-warning/40 px-1.5 text-[10.5px] text-warning">writes</span>}
        {doc.since && <span>since {doc.since}</span>}
      </div>
      {doc.refused && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" /> {doc.refused}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

const EXAMPLES = [
  'INFO keyspace',
  'SCAN 0 MATCH user:* COUNT 100',
  'TYPE mykey',
  'MEMORY USAGE mykey',
  'CONFIG GET maxmemory*',
];

export function ConsoleView({ db }: { db: number }) {
  const run = useCommand(db);
  const docsQuery = useCommandDocs();
  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const byName = useMemo(() => new Map(docs.map((d) => [d.name, d])), [docs]);

  const [entries, setEntriesState] = useState<Entry[]>(() => transcripts.get(db) ?? []);
  const setEntries = (update: (e: Entry[]) => Entry[]) =>
    setEntriesState((prev) => {
      const next = update(prev);
      transcripts.set(db, next);
      return next;
    });

  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [history, setHistory] = useState<string[]>(() => storage.getJson<string[]>(HISTORY_KEY, []));
  const [historyAt, setHistoryAt] = useState(-1);
  const [raw, setRaw] = useState(() => storage.get(RAW_KEY) === '1');
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [confirm, setConfirm] = useState<{ lines: string[]; reasons: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest output in view (after React has rendered it).
  const scrollToEnd = () => requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end' }));

  const { start: lineStart, before } = caretLine(value, caret);
  const completion = dismissed ? null : complete(before, docs, byName);
  const picked = completion ? completion.items[Math.min(pick, completion.items.length - 1)] : null;
  const fullLine = value.slice(lineStart).split('\n')[0] ?? '';
  const hint = picked ?? docForLine(fullLine, byName);

  const edit = (next: string, nextCaret = next.length) => {
    setValue(next);
    setCaret(nextCaret);
    setPick(0);
    setDismissed(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const accept = (doc: CommandDoc) => {
    const from = lineStart + completion!.from;
    const insert = `${upper(doc.name)} `;
    edit(value.slice(0, from) + insert + value.slice(caret), from + insert.length);
  };

  const execute = async (lines: string[]) => {
    setRunning(true);
    const next = [...lines.toReversed(), ...history.filter((h) => !lines.includes(h))].slice(0, HISTORY_MAX);
    setHistory(next);
    storage.setJson(HISTORY_KEY, next);
    setHistoryAt(-1);
    edit('', 0);
    for (const command of lines) {
      const n = ++counter;
      setEntries((e) => [...e, { n, db, command }]);
      scrollToEnd();
      try {
        const res = await run.mutateAsync(command);
        setEntries((e) => e.map((x) => (x.n === n ? { ...x, reply: res.reply, ms: res.ms } : x)));
      } catch (err) {
        setEntries((e) => e.map((x) => (x.n === n ? { ...x, error: errorMessage(err) } : x)));
      }
      scrollToEnd();
    }
    setRunning(false);
    input.current?.focus();
  };

  const submit = (text = value) => {
    const lines = commandsIn(text);
    if (!lines.length || running) return;
    const reasons = lines.map((l) => danger(l, db)).filter((r): r is string => !!r);
    if (reasons.length) setConfirm({ lines, reasons: [...new Set(reasons)] });
    else void execute(lines);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (completion && picked) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = completion.items.length;
        setPick((p) => (Math.min(p, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      // Tab always completes; Enter completes a partial name, but runs a command that's typed in full.
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && completion.typed !== picked.name)) {
        e.preventDefault();
        accept(picked);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp' && !value.includes('\n') && history.length) {
      e.preventDefault();
      const i = Math.min(historyAt + 1, history.length - 1);
      setHistoryAt(i);
      edit(history[i]!);
    } else if (e.key === 'ArrowDown' && !value.includes('\n') && historyAt >= 0) {
      e.preventDefault();
      const i = historyAt - 1;
      setHistoryAt(i);
      edit(i >= 0 ? history[i]! : '');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setEntries(() => []);
    }
  };

  const copy = (entry: Entry) => {
    const text = entry.error ?? (entry.reply ? replyToText(entry.reply, raw) : '');
    void navigator.clipboard.writeText(text).then(() => toast.success('Output copied'));
  };

  const rows = Math.min(Math.max(value.split('\n').length, 1), 8);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-medium">Console</h1>
        <span className="hidden truncate text-xs text-muted-foreground lg:inline">
          <Kbd>Tab</Kbd> complete · <Kbd>↑</Kbd> <Kbd>↓</Kbd> history · <Kbd>Shift ↵</Kbd> new line · <Kbd>Ctrl L</Kbd>{' '}
          clear
        </span>
        <div className="flex-1" />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={raw}
            onCheckedChange={(v) => {
              setRaw(v);
              storage.set(RAW_KEY, v ? '1' : '0');
            }}
            aria-label="Raw output"
          />
          Raw
        </label>
        <Button variant="ghost" size="sm" onClick={() => setEntries(() => [])} disabled={!entries.length}>
          <Eraser /> Clear
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto bg-grid-header/50 font-mono text-[12.5px] leading-relaxed"
        onClick={() => window.getSelection()?.isCollapsed && input.current?.focus()}
      >
        <div className="space-y-4 p-4">
          {entries.length === 0 && (
            <div className="max-w-2xl space-y-3 font-sans text-sm text-muted-foreground">
              <p>Run any Redis command, the same as in redis-cli. Start typing for suggestions, or try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => edit(ex)}
                    className="rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground hover:bg-accent"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <p className="text-xs">
                Paste several lines to run them in order. Commands that hold the connection (SUBSCRIBE, MONITOR, MULTI,
                blocking pops) aren't available here; switch databases with the menu at the top instead of SELECT.
              </p>
            </div>
          )}
          {entries.map((e) => {
            const size = e.reply ? replySize(e.reply) : null;
            return (
              <div key={e.n} className="group space-y-1">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-muted-foreground select-none">db{e.db}&gt;</span>
                  <span className="min-w-0 flex-1 font-medium break-all">{e.command}</span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-xs" onClick={() => edit(e.command)} aria-label="Edit">
                          <Pencil />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => submit(e.command)}
                          disabled={running}
                          aria-label="Run again"
                        >
                          <RotateCw />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Run again</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => copy(e)}
                          disabled={!e.reply && !e.error}
                          aria-label="Copy output"
                        >
                          <Copy />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy output</TooltipContent>
                    </Tooltip>
                  </div>
                  {e.ms !== undefined && (
                    <span className="shrink-0 pt-px font-sans text-xs text-muted-foreground tabular-nums">
                      {size !== null && `${size.toLocaleString()} item${size === 1 ? '' : 's'} · `}
                      {e.ms < 1 ? '<1' : e.ms.toFixed(0)} ms
                    </span>
                  )}
                </div>
                <div className="pl-2">
                  {e.error ? (
                    <span className="text-destructive">{e.error}</span>
                  ) : e.reply ? (
                    <ReplyView reply={e.reply} raw={raw} />
                  ) : (
                    <Spinner className="size-3.5" />
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      <div className="relative shrink-0 border-t bg-background">
        {completion && (
          <div
            className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-lg border bg-popover shadow-none"
            role="listbox"
            aria-label="Command suggestions"
          >
            {completion.items.map((d, i) => (
              <button
                key={d.name}
                type="button"
                role="option"
                aria-selected={d === picked}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => accept(d)}
                onMouseEnter={() => setPick(i)}
                className={cn('flex w-full items-baseline gap-3 px-3 py-1.5 text-left', d === picked && 'bg-accent')}
              >
                <span
                  className={cn(
                    'shrink-0 font-mono text-[12.5px] font-medium',
                    d.refused && 'text-muted-foreground line-through',
                  )}
                >
                  {upper(d.name)}
                </span>
                <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">{d.syntax}</span>
                <span className="ml-auto hidden max-w-[40%] shrink-0 truncate text-xs text-muted-foreground md:block">
                  {d.summary}
                </span>
              </button>
            ))}
          </div>
        )}
        {hint && (
          <div className="border-b bg-grid-header px-4 py-2">
            <Signature doc={hint} />
          </div>
        )}
        <form
          className="flex items-start gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="pt-[3px] font-mono text-[12.5px] text-muted-foreground select-none">db{db}&gt;</span>
          <textarea
            ref={input}
            autoFocus
            rows={rows}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCaret(e.target.selectionStart);
              setHistoryAt(-1);
              setPick(0);
              setDismissed(false);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Redis command"
            aria-autocomplete="list"
            placeholder="GET mykey"
            className="min-w-0 flex-1 resize-none bg-transparent font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
          <Button type="submit" size="sm" disabled={!value.trim() || running}>
            {running ? <Spinner className="text-current" /> : <CornerDownLeft />} Run
          </Button>
        </form>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Run {confirm && confirm.lines.length > 1 ? `these ${confirm.lines.length} commands` : 'this command'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs text-foreground">
                  {confirm?.lines.join('\n')}
                </pre>
                <ul className="list-disc space-y-1 pl-4">
                  {confirm?.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const lines = confirm!.lines;
                setConfirm(null);
                void execute(lines);
              }}
            >
              Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
