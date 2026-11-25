import { PostgreSQL, sql as sqlLanguage } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import {
  ArrowUpCircle,
  Blocks,
  Copy,
  Hash,
  Power,
  PowerOff,
  RotateCcw,
  Save,
  SquareFunction,
  SquareTerminal,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ObjectAction, ObjectKind } from '@shared/types';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert, errorMessage, Kbd, Spinner } from '@/components/app/feedback';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@deck/ui/components/alert-dialog';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@deck/ui/components/dialog';
import { Input } from '@deck/ui/components/input';
import { Label } from '@deck/ui/components/label';
import { dbHref, navigate, objectHref } from '@/lib/router';
import { sqlThemeDark, sqlThemeLight } from '@/lib/sql-theme';
import { openInSqlEditor } from '@/lib/sql-draft';
import { useTheme } from '@deck/ui/components/theme-provider';

const KIND: Record<ObjectKind, { label: string; icon: LucideIcon }> = {
  function: { label: 'Function', icon: SquareFunction },
  trigger: { label: 'Trigger', icon: Zap },
  sequence: { label: 'Sequence', icon: Hash },
  extension: { label: 'Extension', icon: Blocks },
};

export function ObjectView({
  db,
  kind,
  oid,
  readonly,
}: {
  db: string;
  kind: ObjectKind;
  oid: number;
  readonly: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...keys.db(db), 'object', kind, oid],
    queryFn: () => api.object(db, kind, oid),
    retry: false,
  });
  const [dialog, setDialog] = useState<'drop' | 'restart' | null>(null);

  const act = useMutation({
    mutationFn: (a: ObjectAction) => api.objectAction(db, a),
    onSuccess: (r, a) => {
      toast.success(r.message);
      void qc.invalidateQueries({ queryKey: keys.db(db) });
      setDialog(null);
      if (a.action === 'drop') navigate(dbHref(db), true);
      else if (a.kind === 'function' && a.action === 'replace' && r.oid && r.oid !== a.oid)
        navigate(objectHref(db, 'function', r.oid), true);
    },
    onError: (e) => toast.error('That didn’t work', { description: errorMessage(e) }),
  });

  if (q.isPending) return <CenteredSpinner />;
  if (q.isError) return <ErrorAlert error={q.error} className="m-6 w-auto" />;
  const d = q.data;
  const { label, icon: Icon } = KIND[kind];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="size-3.5" /> {label}
              {d.schema && <span className="font-mono">· {d.schema}</span>}
              {kind === 'trigger' && d.properties.find(([k]) => k === 'Status')?.[1] === 'disabled' && (
                <Badge variant="outline">disabled</Badge>
              )}
              {d.update && (
                <Badge variant="outline" className="border-warning/40 text-warning">
                  update to {d.update} available
                </Badge>
              )}
            </div>
            <h1 className="font-mono text-xl font-semibold break-all">{d.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void navigator.clipboard.writeText(d.definition).then(() => toast.success('Copied definition'))
              }
            >
              <Copy /> Copy SQL
            </Button>
            {kind === 'function' && (
              <Button variant="outline" size="sm" onClick={() => openInSqlEditor(db, d.definition)}>
                <SquareTerminal /> Open in SQL editor
              </Button>
            )}
            {!readonly && kind === 'trigger' && (
              <Button
                variant="outline"
                size="sm"
                disabled={act.isPending}
                onClick={() => {
                  const off = d.properties.find(([k]) => k === 'Status')?.[1] === 'disabled';
                  act.mutate({ kind: 'trigger', oid, action: off ? 'enable' : 'disable' });
                }}
              >
                {d.properties.find(([k]) => k === 'Status')?.[1] === 'disabled' ? (
                  <>
                    <Power /> Enable
                  </>
                ) : (
                  <>
                    <PowerOff /> Disable
                  </>
                )}
              </Button>
            )}
            {!readonly && kind === 'sequence' && (
              <Button variant="outline" size="sm" onClick={() => setDialog('restart')}>
                <RotateCcw /> Set next value…
              </Button>
            )}
            {!readonly && kind === 'extension' && d.update && (
              <Button
                variant="outline"
                size="sm"
                disabled={act.isPending}
                onClick={() => act.mutate({ kind: 'extension', oid, action: 'update' })}
              >
                <ArrowUpCircle /> Update to {d.update}
              </Button>
            )}
            {!readonly && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDialog('drop')}
              >
                <Trash2 /> {kind === 'extension' ? 'Remove' : 'Drop'}
              </Button>
            )}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-6">
            <DefinitionEditor
              key={`${oid}:${d.definition}`}
              title={kind === 'function' ? 'Definition' : kind === 'trigger' ? 'Trigger' : 'Definition'}
              initial={d.definition}
              editable={!readonly && d.editable}
              saving={act.isPending}
              onSave={(sql) => act.mutate({ kind: 'function', oid, action: 'replace', sql })}
            />
            {kind === 'trigger' && d.triggerFunction && (
              <DefinitionEditor
                key={`fn:${d.triggerFunction.oid}:${d.triggerFunction.definition}`}
                title={`Function it runs: ${d.triggerFunction.title}`}
                initial={d.triggerFunction.definition}
                editable={!readonly}
                saving={act.isPending}
                onSave={(sql) => act.mutate({ kind: 'function', oid: d.triggerFunction!.oid, action: 'replace', sql })}
                link={objectHref(db, 'function', d.triggerFunction.oid)}
              />
            )}
          </div>
          <dl className="h-fit divide-y overflow-hidden rounded-lg border text-sm">
            {d.properties.map(([k, v]) => (
              <div key={k} className="px-4 py-2.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 font-mono text-[13px] break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {dialog === 'drop' && (
        <DropObjectDialog
          what={`${label.toLowerCase()} ${d.title}`}
          extension={kind === 'extension'}
          pending={act.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(cascade) => act.mutate({ kind, oid, action: 'drop', cascade } as ObjectAction)}
        />
      )}
      {dialog === 'restart' && d.sequence && (
        <RestartDialog
          name={d.name}
          current={d.sequence.lastValue}
          increment={d.sequence.increment}
          pending={act.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(value) => act.mutate({ kind: 'sequence', oid, action: 'restart', value })}
        />
      )}
    </div>
  );
}

function DefinitionEditor({
  title,
  initial,
  editable,
  saving,
  onSave,
  link,
}: {
  title: string;
  initial: string;
  editable: boolean;
  saving: boolean;
  onSave: (sql: string) => void;
  link?: string;
}) {
  const { resolved } = useTheme();
  const [text, setText] = useState(initial);
  const dirty = text !== initial;
  // The keymap is created once; route it through a ref so it sees fresh state.
  const saveRef = useRef(() => {});
  useLayoutEffect(() => {
    saveRef.current = () => {
      if (editable && dirty && !saving) onSave(text);
    };
  });
  const extensions = useMemo(
    () => [
      sqlLanguage({ dialect: PostgreSQL }),
      EditorView.lineWrapping,
      // Key handlers run on key presses, after render, so reading the ref here is safe.
      /* oxlint-disable react/refs */
      Prec.highest(
        keymap.of([
          { key: 'Mod-s', run: () => (saveRef.current(), true) },
          { key: 'Mod-Enter', run: () => (saveRef.current(), true) },
        ]),
      ),
      /* oxlint-enable react/refs */
    ],
    [],
  );
  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-grid-header px-4 py-2 text-xs">
        <span className="min-w-0 truncate font-medium">{title}</span>
        {link && (
          <a href={link} className="text-link hover:underline">
            open
          </a>
        )}
        {!editable && <Badge variant="outline">read-only</Badge>}
        <div className="flex-1" />
        {editable && dirty && <span className="text-warning">Unsaved changes</span>}
        {editable && (
          <>
            <Button variant="ghost" size="xs" disabled={!dirty || saving} onClick={() => setText(initial)}>
              Revert
            </Button>
            <Button size="xs" disabled={!dirty || saving} onClick={() => saveRef.current()}>
              {saving ? <Spinner className="text-current" /> : <Save />}
              Save
              <span className="hidden opacity-60 sm:inline">
                <Kbd>⌘S</Kbd>
              </span>
            </Button>
          </>
        )}
      </div>
      <div className="sql-editor max-h-[65vh] overflow-auto">
        <CodeMirror
          value={text}
          onChange={setText}
          editable={editable}
          readOnly={!editable}
          theme={resolved === 'dark' ? sqlThemeDark : sqlThemeLight}
          extensions={extensions}
          basicSetup={{ foldGutter: false, highlightActiveLine: editable }}
        />
      </div>
    </section>
  );
}

function DropObjectDialog({
  what,
  extension,
  pending,
  onClose,
  onConfirm,
}: {
  what: string;
  extension: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: (cascade: boolean) => void;
}) {
  const [cascade, setCascade] = useState(false);
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{extension ? 'Remove extension?' : 'Drop this object?'}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono break-all text-foreground">{what}</span>{' '}
            {extension
              ? 'and every function, type and operator it added will be removed.'
              : 'will be permanently removed.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={cascade} onCheckedChange={(v) => setCascade(v === true)} />
          <span>
            Cascade
            <span className="block text-xs text-muted-foreground">
              Also drop what depends on it (triggers, defaults, columns using its types…).
            </span>
          </span>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm(cascade)}>
            {pending && <Spinner className="text-current" />}
            {extension ? 'Remove' : 'Drop'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestartDialog({
  name,
  current,
  increment,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  current: string | null;
  increment: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const suggested = current ? String(BigInt(current) + BigInt(increment)) : '1';
  const [value, setValue] = useState(suggested);
  const valid = /^-?\d+$/.test(value.trim());
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConfirm(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Set next value</DialogTitle>
            <DialogDescription>
              The next call to <span className="font-mono text-foreground">nextval('{name}')</span> returns this number.
              Last handed out: <span className="font-mono text-foreground">{current ?? 'none yet'}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="seq-next">Next value</Label>
            <Input
              id="seq-next"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              inputMode="numeric"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Going lower than values already in use can cause duplicate key errors.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending && <Spinner className="text-current" />}
              Set next value
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
