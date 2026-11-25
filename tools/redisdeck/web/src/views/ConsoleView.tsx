import { CornerDownLeft, Eraser } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Reply } from '@shared/types';
import { Button } from '@deck/ui/components/button';
import { storage } from '@deck/ui/lib/storage';
import { cn } from '@deck/ui/lib/utils';
import { useCommand } from '@/api/hooks';
import { errorMessage, Kbd, Spinner } from '@/components/feedback';

const HISTORY_KEY = 'redisdeck.history';
const HISTORY_MAX = 200;

interface Entry {
  n: number;
  db: number;
  command: string;
  reply?: Reply;
  error?: string;
  ms?: number;
}

/** A reply rendered the way redis-cli prints it. */
function ReplyView({ reply, depth = 0 }: { reply: Reply; depth?: number }): ReactNode {
  switch (reply.kind) {
    case 'nil':
      return <span className="text-muted-foreground">(nil)</span>;
    case 'integer':
      return (
        <span>
          <span className="text-muted-foreground">(integer)</span> {reply.value}
        </span>
      );
    case 'status':
      return <span>{reply.value}</span>;
    case 'error':
      return <span className="text-destructive">(error) {reply.value}</span>;
    case 'string':
      return (
        <span className="break-all whitespace-pre-wrap" title={reply.value.binary ? 'Binary value, shown escaped' : undefined}>
          "{reply.value.text}"
        </span>
      );
    case 'array': {
      if (!reply.items.length) return <span className="text-muted-foreground">(empty array)</span>;
      const width = String(reply.items.length).length;
      return (
        <div className={cn(depth > 0 && 'inline-block align-top')}>
          {reply.items.map((item, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground tabular-nums">{`${String(i + 1).padStart(width)})`}</span>
              <div className="min-w-0">
                <ReplyView reply={item} depth={depth + 1} />
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}

const EXAMPLES = ['INFO keyspace', 'SCAN 0 MATCH user:* COUNT 100', 'TYPE mykey', 'MEMORY USAGE mykey', 'CONFIG GET maxmemory*'];

export function ConsoleView({ db }: { db: number }) {
  const run = useCommand(db);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [line, setLine] = useState('');
  const [history, setHistory] = useState<string[]>(() => storage.getJson<string[]>(HISTORY_KEY, []));
  const [cursor, setCursor] = useState(-1); // position in history while pressing ↑/↓
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [entries]);

  const submit = (command: string) => {
    const text = command.trim();
    if (!text || run.isPending) return;
    const n = ++counter.current;
    setEntries((e) => [...e, { n, db, command: text }]);
    const next = [text, ...history.filter((h) => h !== text)].slice(0, HISTORY_MAX);
    setHistory(next);
    storage.setJson(HISTORY_KEY, next);
    setLine('');
    setCursor(-1);
    run.mutate(text, {
      onSuccess: (res) => setEntries((e) => e.map((x) => (x.n === n ? { ...x, reply: res.reply, ms: res.ms } : x))),
      onError: (err) => setEntries((e) => e.map((x) => (x.n === n ? { ...x, error: errorMessage(err) } : x))),
      onSettled: () => input.current?.focus(),
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit(line);
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const i = Math.min(cursor + 1, history.length - 1);
      setCursor(i);
      setLine(history[i]!);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = cursor - 1;
      setCursor(Math.max(i, -1));
      setLine(i >= 0 ? history[i]! : '');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-medium">Console</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Commands run on db{db}. <Kbd>↑</Kbd> <Kbd>↓</Kbd> history, <Kbd>Ctrl L</Kbd> clear.
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setEntries([])} disabled={!entries.length}>
          <Eraser /> Clear
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-grid-header/50 font-mono text-[12.5px] leading-relaxed" onClick={() => window.getSelection()?.isCollapsed && input.current?.focus()}>
        <div className="space-y-4 p-4">
          {entries.length === 0 && (
            <div className="space-y-3 font-sans text-sm text-muted-foreground">
              <p>Run any Redis command, the same as in redis-cli. Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setLine(ex)} className="rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground hover:bg-accent">
                    {ex}
                  </button>
                ))}
              </div>
              <p className="text-xs">
                Commands that hold the connection (SUBSCRIBE, MONITOR, MULTI, blocking pops) aren't available here. Switch databases with the menu at the top instead of SELECT.
              </p>
            </div>
          )}
          {entries.map((e) => (
            <div key={e.n} className="space-y-1">
              <div className="flex gap-2">
                <span className="shrink-0 text-muted-foreground select-none">db{e.db}&gt;</span>
                <span className="font-medium break-all">{e.command}</span>
                {e.ms !== undefined && <span className="ml-auto shrink-0 font-sans text-xs text-muted-foreground tabular-nums">{e.ms < 1 ? '<1' : e.ms.toFixed(0)} ms</span>}
              </div>
              <div className="pl-2">
                {e.error ? <span className="text-destructive">{e.error}</span> : e.reply ? <ReplyView reply={e.reply} /> : <Spinner className="size-3.5" />}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t bg-background px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(line);
        }}
      >
        <span className="font-mono text-[12.5px] text-muted-foreground select-none">db{db}&gt;</span>
        <input
          ref={input}
          autoFocus
          value={line}
          onChange={(e) => {
            setLine(e.target.value);
            setCursor(-1);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Redis command"
          placeholder="GET mykey"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/60"
        />
        <Button type="submit" size="sm" disabled={!line.trim() || run.isPending}>
          {run.isPending ? <Spinner className="text-current" /> : <CornerDownLeft />} Run
        </Button>
      </form>
    </div>
  );
}
