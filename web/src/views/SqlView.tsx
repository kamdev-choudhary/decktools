import { PostgreSQL, sql as sqlLanguage, type SQLNamespace } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { Download, History, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QueryResult } from '@shared/types';
import { ApiError } from '@/api/client';
import { useRunQuery, useTables } from '@/api/hooks';
import { DataGrid } from '@/components/app/DataGrid';
import { ErrorAlert, Kbd, Spinner } from '@/components/app/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { downloadCsv, formatNumber, lineCol } from '@/lib/format';
import { sqlThemeDark, sqlThemeLight } from '@/lib/sql-theme';
import { storage } from '@/lib/storage';
import { useTheme } from '@/lib/theme';

const HISTORY_MAX = 30;

export function SqlView({ db }: { db: string }) {
  const draftKey = `pgdeck.sql.draft.${db}`;
  const historyKey = `pgdeck.sql.history.${db}`;

  const { resolved } = useTheme();
  const tables = useTables(db);
  const run = useRunQuery(db);
  const viewRef = useRef<EditorView | null>(null);
  const [sql, setSql] = useState(() => storage.get(draftKey) ?? 'select now();');
  const [history, setHistory] = useState<string[]>(() => storage.getJson<string[]>(historyKey, []));
  // Where the last submitted text started in the editor, to map error positions back.
  const [lastRunFrom, setLastRunFrom] = useState(0);

  useEffect(() => storage.set(draftKey, sql), [draftKey, sql]);

  const execute = () => {
    const view = viewRef.current;
    const sel = view?.state.selection.main;
    const useSelection = !!view && !!sel && !sel.empty;
    const text = useSelection ? view.state.sliceDoc(sel.from, sel.to) : sql;
    const from = useSelection ? sel.from : 0;
    if (!text.trim()) return;

    setLastRunFrom(from);
    const nextHistory = [text, ...history.filter((h) => h !== text)].slice(0, HISTORY_MAX);
    setHistory(nextHistory);
    storage.setJson(historyKey, nextHistory);

    run.mutate(text, {
      onError: (e) => {
        // Put the cursor where Postgres says the error is.
        if (e instanceof ApiError && e.position && view) {
          const anchor = Math.min(from + e.position - 1, view.state.doc.length);
          view.dispatch({ selection: { anchor }, scrollIntoView: true });
          view.focus();
        }
      },
    });
  };

  // The keymap is created once; route it through a ref so it sees fresh state.
  const executeRef = useRef(execute);
  executeRef.current = execute;

  const schema = useMemo(() => {
    const ns: Record<string, Record<string, string[]>> = {};
    for (const t of tables.data ?? []) (ns[t.schema] ??= {})[t.name] = [];
    return ns as SQLNamespace;
  }, [tables.data]);

  const extensions = useMemo(
    () => [
      sqlLanguage({ dialect: PostgreSQL, schema, defaultSchema: 'public' }),
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (executeRef.current(), true) }])),
      EditorView.lineWrapping,
    ],
    [schema],
  );

  const error = run.error;
  const errorAt = error instanceof ApiError && error.position ? lineCol(sql, lastRunFrom + error.position) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b px-4 py-4 md:px-6">
        <div className="sql-editor h-[32vh] min-h-32 resize-y overflow-hidden rounded-lg border bg-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
          <CodeMirror
            value={sql}
            onChange={setSql}
            theme={resolved === 'dark' ? sqlThemeDark : sqlThemeLight}
            extensions={extensions}
            onCreateEditor={(view) => {
              viewRef.current = view;
            }}
            basicSetup={{ foldGutter: false }}
            height="100%"
            className="h-full"
            autoFocus
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={execute} disabled={run.isPending}>
            {run.isPending ? <Spinner className="text-current" /> : <Play />}
            Run
          </Button>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd> runs the selection, or everything
          </span>
          <div className="flex-1" />
          {history.length > 0 && (
            <Select value="" onValueChange={(i) => setSql(history[Number(i)] ?? sql)}>
              <SelectTrigger size="sm" className="w-auto gap-2 text-xs" aria-label="Query history">
                <History className="size-3.5" /> History
              </SelectTrigger>
              <SelectContent align="end" className="max-w-[min(32rem,90vw)]">
                {history.map((h, i) => (
                  <SelectItem key={i} value={String(i)} className="font-mono text-xs">
                    <span className="truncate">{h.replace(/\s+/g, ' ').slice(0, 100)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {run.isError && (
          <ErrorAlert error={error} title="Query failed" className="m-4 w-auto md:mx-6">
            {errorAt && (
              <div className="mt-1 text-muted-foreground">
                at line {errorAt.line}, column {errorAt.col}
              </div>
            )}
          </ErrorAlert>
        )}
        {run.isSuccess &&
          run.data.results.map((r, i) => (
            <ResultBlock
              key={i}
              result={r}
              only={run.data.results.length === 1}
              ms={i === run.data.results.length - 1 ? run.data.ms : undefined}
            />
          ))}
        {(run.isIdle || run.isPending) && (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
            {run.isPending ? (
              <span className="flex items-center gap-2">
                <Spinner /> Running…
              </span>
            ) : (
              'Run a query to see results here.'
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBlock({ result, ms, only }: { result: QueryResult; ms?: number; only: boolean }) {
  const hasRows = result.fields.length > 0;
  return (
    <section className={only ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col border-b'}>
      <div className="flex items-center gap-3 border-b bg-grid-header px-4 py-2 text-xs text-muted-foreground md:px-6">
        <span className="font-mono font-medium text-foreground">{result.command ?? 'OK'}</span>
        <span className="tabular-nums">
          {hasRows
            ? `${formatNumber(result.rows.length)} row${result.rows.length === 1 ? '' : 's'}`
            : result.rowCount !== null
              ? `${formatNumber(result.rowCount)} row${result.rowCount === 1 ? '' : 's'} affected`
              : ''}
        </span>
        {ms !== undefined && <span className="tabular-nums">{ms.toFixed(1)} ms</span>}
        {result.truncated && (
          <Badge variant="outline" className="border-warning/40 text-warning">
            Truncated: raise --max-rows to see more
          </Badge>
        )}
        <div className="flex-1" />
        {hasRows && (
          <Button variant="ghost" size="xs" onClick={() => downloadCsv('query.csv', result.fields, result.rows)}>
            <Download /> CSV
          </Button>
        )}
      </div>
      {hasRows && <DataGrid fields={result.fields} rows={result.rows} className={only ? undefined : 'max-h-[50vh]'} />}
    </section>
  );
}
