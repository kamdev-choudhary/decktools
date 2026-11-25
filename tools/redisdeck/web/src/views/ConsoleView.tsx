import { Braces, Copy, Eraser, Pencil, RotateCw } from 'lucide-react';
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
import { useCommand, useCommandDocs, useServer } from '@/api/hooks';
import { errorMessage, Spinner } from '@/components/feedback';
import {
  caretLine,
  commandsIn,
  complete,
  danger,
  docForLine,
  ghostHint,
  prettyJson,
  promptFor,
  replySize,
  replyToText,
} from '@/lib/console';

const HISTORY_KEY = 'redisdeck.history';
const RAW_KEY = 'redisdeck.console.raw';
const HISTORY_MAX = 200;
/** Array elements rendered before "Show all". */
const ARRAY_PREVIEW = 100;

/**
 * One block of the transcript. `command` entries ran on the server; `help` is
 * answered locally from the command docs; `echo` is a prompt line with nothing
 * run (an empty Enter, or Ctrl+C).
 */
interface Entry {
  n: number;
  kind: 'command' | 'help' | 'echo';
  prompt: string;
  command: string;
  reply?: Reply;
  error?: string;
  ms?: number;
  cancelled?: boolean;
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
          className="inline-flex items-center gap-1 text-link hover:underline"
        >
          <Braces className="size-3" /> show as stored
        </button>
        <pre className="whitespace-pre-wrap">{pretty}</pre>
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
          className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-link opacity-70 hover:underline hover:opacity-100"
        >
          <Braces className="size-3" /> format
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
          <div key={i} className="flex">
            <span className="shrink-0 whitespace-pre text-muted-foreground tabular-nums">{`${String(i + 1).padStart(width)}) `}</span>
            <div className="min-w-0">
              <ReplyView reply={item} raw={false} />
            </div>
          </div>
        ),
      )}
      {!all && (
        <button type="button" onClick={() => setAll(true)} className="text-link hover:underline">
          ... {(items.length - ARRAY_PREVIEW).toLocaleString()} more, show all
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
      return raw ? <span>{reply.value}</span> : <span>(integer) {reply.value}</span>;
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
/* Help                                                                */
/* ------------------------------------------------------------------ */

const upper = (name: string) => name.toUpperCase();

/** `HELP <command>` output, laid out like redis-cli's. */
function CommandHelp({ doc }: { doc: CommandDoc }) {
  return (
    <div className="py-0.5">
      <div>
        <span className="font-semibold text-warning">{upper(doc.name)}</span>{' '}
        <span className="text-muted-foreground">{doc.syntax}</span>
      </div>
      {doc.summary && <div className="pl-2 text-muted-foreground">summary: {doc.summary}</div>}
      {doc.since && <div className="pl-2 text-muted-foreground">since: {doc.since}</div>}
      {doc.group && <div className="pl-2 text-muted-foreground">group: {doc.group}</div>}
      {doc.flags.includes('write') && <div className="pl-2 text-muted-foreground">writes data</div>}
      {doc.refused && <div className="pl-2 text-destructive">not available here: {doc.refused}</div>}
    </div>
  );
}

function GeneralHelp() {
  return (
    <div className="text-muted-foreground">
      <div>Type a Redis command and press Enter, the same as in redis-cli.</div>
      <div>&nbsp;</div>
      <div>
        <span className="text-foreground">HELP &lt;command&gt;</span> usage of a command, e.g. HELP SET
      </div>
      <div>
        <span className="text-foreground">CLEAR</span> clear the screen (also Ctrl+L)
      </div>
      <div>
        <span className="text-foreground">Tab</span> complete · <span className="text-foreground">↑ ↓</span> history ·{' '}
        <span className="text-foreground">Ctrl+C</span> cancel the line ·{' '}
        <span className="text-foreground">Shift+Enter</span> new line
      </div>
      <div>&nbsp;</div>
      <div>Paste several lines to run them in order. Commands that need their own connection</div>
      <div>(SUBSCRIBE, MONITOR, MULTI, blocking pops) and SELECT aren&apos;t available here.</div>
    </div>
  );
}

/** What a HELP line prints. */
function HelpOutput({ topic, byName }: { topic: string; byName: Map<string, CommandDoc> }) {
  if (!topic) return <GeneralHelp />;
  const exact = docForLine(topic, byName);
  if (exact) {
    // HELP CONFIG lists the subcommands too.
    const subs = exact.container
      ? [...byName.values()].filter((d) => d.name.startsWith(`${exact.name} `) && !d.name.endsWith(' help'))
      : [];
    return (
      <div>
        <CommandHelp doc={exact} />
        {subs.map((d) => (
          <CommandHelp key={d.name} doc={d} />
        ))}
      </div>
    );
  }
  return <span className="text-muted-foreground">No help for &quot;{topic}&quot;. Try HELP with a command name.</span>;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

const EXAMPLES = ['INFO keyspace', 'SCAN 0 MATCH * COUNT 100', 'DBSIZE', 'CONFIG GET maxmemory*', 'HELP SET'];

function Prompt({ text }: { text: string }) {
  return <span className="shrink-0 text-success select-none">{text}&nbsp;</span>;
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ConsoleView({ db }: { db: number }) {
  const run = useCommand(db);
  const server = useServer().data;
  const docsQuery = useCommandDocs();
  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const byName = useMemo(() => new Map(docs.map((d) => [d.name, d])), [docs]);
  const prompt = server ? promptFor(server.host, server.port, db) : `db${db}>`;

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

  // Keep the prompt in view (after React has rendered the new output).
  const scrollToEnd = () => requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end' }));

  const { start: lineStart, before } = caretLine(value, caret);
  const completion = dismissed ? null : complete(before, docs, byName);
  const picked = completion ? completion.items[Math.min(pick, completion.items.length - 1)] : null;
  const lineDoc = docForLine(value, byName);
  // The grey argument hint, like redis-cli: single-line input with the caret at the end.
  const ghost =
    lineDoc && !completion && !value.includes('\n') && caret === value.length ? ghostHint(value, lineDoc) : '';

  const edit = (next: string, nextCaret = next.length) => {
    setValue(next);
    setCaret(nextCaret);
    setPick(0);
    setDismissed(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(nextCaret, nextCaret);
    });
    scrollToEnd();
  };

  const accept = (doc: CommandDoc) => {
    const from = lineStart + completion!.from;
    const insert = `${upper(doc.name)} `;
    edit(value.slice(0, from) + insert + value.slice(caret), from + insert.length);
  };

  const add = (entry: Omit<Entry, 'n'>) => {
    const n = ++counter;
    setEntries((e) => [...e, { ...entry, n }]);
    return n;
  };

  const execute = async (lines: string[]) => {
    setRunning(true);
    const next = [...lines.toReversed(), ...history.filter((h) => !lines.includes(h))].slice(0, HISTORY_MAX);
    setHistory(next);
    storage.setJson(HISTORY_KEY, next);
    setHistoryAt(-1);
    edit('', 0);
    for (const command of lines) {
      const [word = '', ...rest] = command.split(/\s+/);
      const local = word.toLowerCase();
      if (local === 'clear' && !rest.length) {
        setEntries(() => []);
        continue;
      }
      if (local === 'help') {
        add({ kind: 'help', prompt, command });
        scrollToEnd();
        continue;
      }
      const n = add({ kind: 'command', prompt, command });
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
    requestAnimationFrame(() => input.current?.focus());
  };

  const submit = (text = value) => {
    if (running) return;
    const lines = commandsIn(text);
    if (!lines.length) {
      // An empty Enter prints a fresh prompt, as in a terminal.
      add({ kind: 'echo', prompt, command: '' });
      edit('', 0);
      return;
    }
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
    const t = e.currentTarget;
    if (e.key === 'Tab') {
      e.preventDefault(); // Never leave the terminal on Tab.
    } else if (e.key === 'Enter' && !e.shiftKey) {
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
    } else if (e.key === 'c' && e.ctrlKey && t.selectionStart === t.selectionEnd) {
      // Ctrl+C with nothing selected cancels the line, like a shell. (Cmd+C still copies.)
      e.preventDefault();
      add({ kind: 'echo', prompt, command: value, cancelled: true });
      setHistoryAt(-1);
      edit('', 0);
    } else if (e.key === 'u' && e.ctrlKey) {
      e.preventDefault();
      edit(value.slice(caret), 0);
    }
  };

  const copy = (entry: Entry) => {
    const text = entry.error ?? (entry.reply ? replyToText(entry.reply, raw) : '');
    void navigator.clipboard.writeText(text).then(() => toast.success('Output copied'));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-medium">Console</h1>
        {server && (
          <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
            {server.product} {server.version} · {server.host}:{server.port} · db{db}
          </span>
        )}
        <div className="flex-1" />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={raw}
            onCheckedChange={(v) => {
              setRaw(v);
              storage.set(RAW_KEY, v ? '1' : '0');
            }}
            aria-label="Raw output, like redis-cli --raw"
          />
          Raw
        </label>
        <Button variant="ghost" size="sm" onClick={() => setEntries(() => [])} disabled={!entries.length}>
          <Eraser /> Clear
        </Button>
      </div>

      {/* The terminal: dark in both themes, output and prompt in one scrolling surface. */}
      <div
        className="dark min-h-0 flex-1 cursor-text overflow-y-auto bg-background font-mono text-[13px] leading-[1.6] text-foreground [color-scheme:dark]"
        onClick={() => window.getSelection()?.isCollapsed && input.current?.focus()}
      >
        <div className="px-4 py-3">
          <div className="text-muted-foreground">
            {server ? `${server.product} ${server.version}` : 'redis'} at{' '}
            {server ? `${server.host}:${server.port}` : '…'}, database {db}. Type HELP for help.
          </div>
          {entries.length === 0 && (
            <div className="mb-1 flex flex-wrap gap-x-3 text-muted-foreground">
              <span>try:</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => edit(ex)} className="text-link hover:underline">
                  {ex}
                </button>
              ))}
            </div>
          )}

          {entries.map((e) => {
            const size = e.reply ? replySize(e.reply) : null;
            return (
              <div key={e.n} className="group">
                <div className="relative flex items-start">
                  <Prompt text={e.prompt} />
                  <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">
                    {e.command}
                    {e.cancelled && <span className="text-muted-foreground">^C</span>}
                  </span>
                  {e.kind === 'command' && (
                    <div className="absolute top-0 right-0 flex items-center gap-0.5 rounded-md bg-background pl-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {e.ms !== undefined && (
                        <span className="mr-1 font-sans text-xs text-muted-foreground tabular-nums">
                          {size !== null && `${size.toLocaleString()} item${size === 1 ? '' : 's'} · `}
                          {e.ms < 1 ? '<1' : e.ms.toFixed(0)} ms
                        </span>
                      )}
                      <IconAction label="Edit" onClick={() => edit(e.command)}>
                        <Pencil />
                      </IconAction>
                      <IconAction label="Run again" onClick={() => submit(e.command)} disabled={running}>
                        <RotateCw />
                      </IconAction>
                      <IconAction label="Copy output" onClick={() => copy(e)} disabled={!e.reply && !e.error}>
                        <Copy />
                      </IconAction>
                    </div>
                  )}
                </div>
                {e.kind === 'help' && <HelpOutput topic={e.command.replace(/^\s*help\s*/i, '')} byName={byName} />}
                {e.kind === 'command' &&
                  (e.error ? (
                    <div className="text-destructive">(error) {e.error}</div>
                  ) : e.reply ? (
                    <ReplyView reply={e.reply} raw={raw} />
                  ) : (
                    <Spinner className="my-1 size-3.5" />
                  ))}
              </div>
            );
          })}

          {/* The live prompt. Hidden, not unmounted, while commands run so it keeps focus. */}
          <div className={cn(running && 'invisible')}>
            <div className="flex items-start">
              <Prompt text={prompt} />
              {/* Input and grey hint share one grid cell, so a hint that wraps makes the row taller. */}
              <div className="grid min-w-0 flex-1 *:[grid-area:1/1]">
                <textarea
                  ref={input}
                  autoFocus
                  rows={1}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setCaret(e.target.selectionStart);
                    setHistoryAt(-1);
                    setPick(0);
                    setDismissed(false);
                    scrollToEnd();
                  }}
                  onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                  onKeyDown={onKeyDown}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  aria-label="Redis command"
                  aria-autocomplete="list"
                  className="z-10 block w-full resize-none overflow-hidden bg-transparent p-0 break-all whitespace-pre-wrap caret-success outline-none field-sizing-content"
                />
                {ghost && (
                  <div
                    aria-hidden
                    className="pointer-events-none break-all whitespace-pre-wrap text-muted-foreground/70"
                  >
                    <span className="invisible">{value}</span>
                    {ghost}
                  </div>
                )}
              </div>
            </div>

            {completion && (
              <div
                className="mt-1 ml-1 max-w-3xl border-l-2 border-success/40"
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
                    className={cn('flex w-full items-baseline gap-3 px-2 text-left', d === picked && 'bg-accent')}
                  >
                    <span className={cn('shrink-0 font-medium', d.refused && 'text-muted-foreground line-through')}>
                      {upper(d.name)}
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">{d.syntax}</span>
                    <span className="ml-auto hidden max-w-[45%] shrink-0 truncate font-sans text-xs text-muted-foreground md:block">
                      {d.summary}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!completion && lineDoc && (
              <div className="mt-0.5 truncate font-sans text-xs text-muted-foreground">
                {lineDoc.refused ? (
                  <span className="text-destructive">{lineDoc.refused}</span>
                ) : (
                  <>
                    {lineDoc.summary}
                    {lineDoc.flags.includes('write') && <span className="ml-2 text-warning">writes</span>}
                    {lineDoc.group && <span className="ml-2">· {lineDoc.group}</span>}
                  </>
                )}
              </div>
            )}
          </div>
          <div ref={bottom} />
        </div>
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
            <AlertDialogCancel onClick={() => requestAnimationFrame(() => input.current?.focus())}>
              Cancel
            </AlertDialogCancel>
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
