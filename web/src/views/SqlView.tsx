import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { PostgreSQL, sql as sqlLanguage, type SQLNamespace } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { QueryResult } from '@shared/types';
import { ApiError } from '../api/client';
import { useRunQuery, useTables } from '../api/hooks';
import { DataGrid } from '../components/DataGrid';
import { ErrorBox, Spinner } from '../components/ErrorBox';
import { downloadCsv, formatNumber, lineCol } from '../lib/format';
import { storage } from '../lib/storage';
import { useTheme } from '../lib/theme';

const DRAFT_KEY = 'pgdeck.sql.draft';
const HISTORY_KEY = 'pgdeck.sql.history';
const HISTORY_MAX = 30;

export function SqlView() {
  const { theme } = useTheme();
  const tables = useTables();
  const run = useRunQuery();
  const viewRef = useRef<EditorView | null>(null);
  const [sql, setSql] = useState(() => storage.get(DRAFT_KEY) ?? 'select now();');
  const [history, setHistory] = useState<string[]>(() => storage.getJson<string[]>(HISTORY_KEY, []));
  // Where the last submitted text started in the editor, to map error positions back.
  const [lastRun, setLastRun] = useState<{ text: string; from: number } | null>(null);

  useEffect(() => storage.set(DRAFT_KEY, sql), [sql]);

  const execute = () => {
    const view = viewRef.current;
    const sel = view?.state.selection.main;
    const useSelection = view && sel && !sel.empty;
    const text = useSelection ? view.state.sliceDoc(sel.from, sel.to) : sql;
    const from = useSelection ? sel.from : 0;
    if (!text.trim()) return;

    setLastRun({ text, from });
    const nextHistory = [text, ...history.filter((h) => h !== text)].slice(0, HISTORY_MAX);
    setHistory(nextHistory);
    storage.setJson(HISTORY_KEY, nextHistory);

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
  const errorAt =
    error instanceof ApiError && error.position && lastRun
      ? lineCol(sql, lastRun.from + error.position)
      : null;

  return (
    <>
      <div className="sql-editor">
        <div className="cm-wrap">
          <CodeMirror
            value={sql}
            onChange={setSql}
            theme={theme}
            extensions={extensions}
            onCreateEditor={(view) => {
              viewRef.current = view;
            }}
            basicSetup={{ foldGutter: false }}
            height="100%"
            autoFocus
          />
        </div>
        <div className="sql-bar">
          <button className="btn primary" onClick={execute} disabled={run.isPending}>
            {run.isPending ? 'Running…' : '▶ Run'}
          </button>
          <span className="hint">
            <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> runs the selection, or everything
          </span>
          <div className="spacer" />
          {history.length > 0 && (
            <select
              className="input history"
              value=""
              onChange={(e) => e.target.value && setSql(e.target.value)}
              aria-label="Query history"
            >
              <option value="">History…</option>
              {history.map((h, i) => (
                <option key={i} value={h}>
                  {h.replace(/\s+/g, ' ').slice(0, 90)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="results">
        {run.isPending && (
          <div className="welcome">
            <Spinner /> Running…
          </div>
        )}
        {run.isError && (
          <ErrorBox error={error}>{errorAt && <div>at line {errorAt.line}, column {errorAt.col}</div>}</ErrorBox>
        )}
        {run.isSuccess &&
          run.data.results.map((r, i) => (
            <ResultBlock key={i} result={r} ms={i === run.data.results.length - 1 ? run.data.ms : undefined} />
          ))}
        {run.isIdle && <div className="welcome hint">Results appear here.</div>}
      </div>
    </>
  );
}

function ResultBlock({ result, ms }: { result: QueryResult; ms?: number }) {
  const hasRows = result.fields.length > 0;
  return (
    <section className="result">
      <div className="result-head">
        <strong>{result.command ?? 'OK'}</strong>
        <span>
          {hasRows
            ? `${formatNumber(result.rows.length)} row(s)`
            : result.rowCount !== null
              ? `${formatNumber(result.rowCount)} row(s) affected`
              : ''}
        </span>
        {result.truncated && <span className="badge warn">truncated, raise --max-rows to see more</span>}
        {ms !== undefined && <span>{ms.toFixed(1)} ms</span>}
        <div className="spacer" />
        {hasRows && (
          <button className="btn ghost" onClick={() => downloadCsv('query.csv', result.fields, result.rows)}>
            Export CSV
          </button>
        )}
      </div>
      {hasRows && <DataGrid fields={result.fields} rows={result.rows} />}
    </section>
  );
}
