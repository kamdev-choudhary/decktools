import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Copy,
  CopyPlus,
  Download,
  Eraser,
  FileCode2,
  FileSpreadsheet,
  MoreHorizontal,
  Network,
  PencilLine,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RelKind, TableAction } from '@shared/types';
import { api, BASE } from '@/api/client';
import { keys, useInfo } from '@/api/hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dbHref, diagramHref, navigate, parseRoute, tableHref } from '@/lib/router';
import { cn } from '@/lib/utils';
import { errorMessage, Spinner } from './feedback';

type Dialogs = 'rename' | 'duplicate' | 'truncate' | 'drop' | null;

interface TableActionsMenuProps {
  db: string;
  schema: string;
  table: string;
  kind: RelKind;
  /** Visual style of the ⋯ trigger. */
  variant?: 'sidebar' | 'toolbar';
  className?: string;
}

const KIND_WORD: Record<RelKind, string> = { r: 'table', p: 'table', f: 'foreign table', v: 'view', m: 'materialized view' };

function downloadUrl(href: string) {
  const a = Object.assign(document.createElement('a'), { href });
  document.body.append(a);
  a.click();
  a.remove();
}

/** ⋯ menu with whole-table operations, plus the dialogs they open. */
export function TableActionsMenu({ db, schema, table, kind, variant = 'toolbar', className }: TableActionsMenuProps) {
  const qc = useQueryClient();
  const info = useInfo(db);
  const readonly = info.data?.readonly ?? false;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const isTable = kind === 'r' || kind === 'p';
  const word = KIND_WORD[kind];
  const full = `${schema}.${table}`;

  const run = useMutation({
    mutationFn: (action: TableAction) => api.tableAction(db, schema, table, action),
    onSuccess: (res, action) => {
      toast.success(res.message);
      void qc.invalidateQueries({ queryKey: keys.db(db) });
      // If we're looking at this table, follow it (rename) or leave (drop).
      const r = parseRoute(location.hash);
      const here = r.view === 'table' && r.db === db && r.schema === schema && r.table === table;
      if (here && action.action === 'drop') navigate(dbHref(db), true);
      if (here && action.action === 'rename') navigate(tableHref(db, schema, action.newName), true);
      setDialog(null);
    },
    onError: (e) => toast.error('Action failed', { description: errorMessage(e) }),
  });

  const copyDdl = async () => {
    try {
      const { sql } = await api.ddl(db, schema, table);
      await navigator.clipboard.writeText(sql);
      toast.success(`Copied CREATE statement for ${table}`);
    } catch (e) {
      toast.error('Could not copy', { description: errorMessage(e) });
    }
  };

  const dumpHref = `${BASE}api/db/${encodeURIComponent(db)}/dump?${new URLSearchParams({
    structure: '1',
    data: '1',
    tables: JSON.stringify([{ schema, table }]),
  })}`;
  const csvHref = `${BASE}api/db/${encodeURIComponent(db)}/export?${new URLSearchParams({ schema, table, format: 'csv' })}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={variant === 'sidebar' ? 'icon-xs' : 'icon-sm'}
            aria-label={`Actions for ${table}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              variant === 'sidebar' &&
                'text-muted-foreground opacity-0 group-hover/item:opacity-100 hover:bg-background focus-visible:opacity-100 data-[state=open]:opacity-100',
              className,
            )}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={variant === 'sidebar' ? 'start' : 'end'} side={variant === 'sidebar' ? 'right' : 'bottom'} className="w-60">
          <DropdownMenuLabel className="truncate font-mono text-xs font-normal text-muted-foreground" title={full}>
            {full}
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(table).then(() => toast.success('Copied table name'));
            }}
          >
            <Copy /> Copy name
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyDdl()}>
            <FileCode2 /> Copy CREATE statement
          </DropdownMenuItem>
          {isTable && (
            <DropdownMenuItem onSelect={() => navigate(diagramHref(db, `${schema}.${table}`))}>
              <Network /> Show in ER diagram
            </DropdownMenuItem>
          )}
          {isTable && (
            <>
              <DropdownMenuItem onSelect={() => downloadUrl(dumpHref)}>
                <Download /> Download as SQL
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadUrl(csvHref)}>
                <FileSpreadsheet /> Download data as CSV
              </DropdownMenuItem>
            </>
          )}

          {!readonly && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog('rename')}>
                <PencilLine /> Rename…
              </DropdownMenuItem>
              {isTable && (
                <DropdownMenuItem onSelect={() => setDialog('duplicate')}>
                  <CopyPlus /> Duplicate…
                </DropdownMenuItem>
              )}
            </>
          )}

          {(isTable || kind === 'm') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run.mutate({ action: 'analyze' })}>
                <Activity /> Analyze
                <span className="ml-auto text-[11px] text-muted-foreground">update stats</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run.mutate({ action: 'vacuum', full: false })}>
                <Sparkles /> Vacuum
                <span className="ml-auto text-[11px] text-muted-foreground">reclaim space</span>
              </DropdownMenuItem>
              {kind === 'm' && !readonly && (
                <DropdownMenuItem onSelect={() => run.mutate({ action: 'refresh' })}>
                  <RefreshCw /> Refresh view
                </DropdownMenuItem>
              )}
            </>
          )}

          {!readonly && (
            <>
              <DropdownMenuSeparator />
              {isTable && (
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog('truncate')}>
                  <Eraser /> Truncate…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog('drop')}>
                <Trash2 /> Drop {word}…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'rename' && (
        <NameDialog
          title={`Rename ${word}`}
          description={full}
          label="New name"
          initial={table}
          confirm="Rename"
          pending={run.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(newName) => run.mutate({ action: 'rename', newName })}
        />
      )}
      {dialog === 'duplicate' && (
        <NameDialog
          title="Duplicate table"
          description={`Copies columns, defaults, constraints and indexes of ${full}. Foreign keys aren't copied.`}
          label="New table name"
          initial={`${table}_copy`}
          confirm="Duplicate"
          withDataOption
          pending={run.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(newName, withData) => run.mutate({ action: 'duplicate', newName, withData: !!withData })}
        />
      )}
      {dialog === 'truncate' && (
        <TruncateDialog table={full} pending={run.isPending} onClose={() => setDialog(null)} onConfirm={(o) => run.mutate({ action: 'truncate', ...o })} />
      )}
      {dialog === 'drop' && (
        <DropDialog
          name={table}
          full={full}
          word={word}
          pending={run.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(cascade) => run.mutate({ action: 'drop', cascade })}
        />
      )}
    </>
  );
}

function NameDialog({
  title,
  description,
  label,
  initial,
  confirm,
  withDataOption,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  label: string;
  initial: string;
  confirm: string;
  withDataOption?: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string, withData?: boolean) => void;
}) {
  const [name, setName] = useState(initial);
  const [withData, setWithData] = useState(true);
  const valid = name.trim().length > 0 && name.trim().length <= 63 && (withDataOption || name.trim() !== initial);
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit(name.trim(), withData);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="break-all">{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="table-name">{label}</Label>
            <Input id="table-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} className="font-mono" />
          </div>
          {withDataOption && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={withData} onCheckedChange={(v) => setWithData(v === true)} /> Copy the data too
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending && <Spinner className="text-current" />}
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TruncateDialog({
  table,
  pending,
  onClose,
  onConfirm,
}: {
  table: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (o: { cascade: boolean; restartIdentity: boolean }) => void;
}) {
  const [cascade, setCascade] = useState(false);
  const [restartIdentity, setRestartIdentity] = useState(true);
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Empty this table?</AlertDialogTitle>
          <AlertDialogDescription>
            Every row in <span className="font-mono text-foreground">{table}</span> will be deleted. The table and its structure stay. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={restartIdentity} onCheckedChange={(v) => setRestartIdentity(v === true)} />
            <span>
              Restart identity
              <span className="block text-xs text-muted-foreground">Reset auto-increment sequences back to their start.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={cascade} onCheckedChange={(v) => setCascade(v === true)} />
            <span>
              Cascade
              <span className="block text-xs text-muted-foreground">Also empty tables that reference this one with foreign keys.</span>
            </span>
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm({ cascade, restartIdentity })}>
            {pending && <Spinner className="text-current" />}
            Truncate
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DropDialog({
  name,
  full,
  word,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  full: string;
  word: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (cascade: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const [cascade, setCascade] = useState(false);
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop {word}?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-foreground">{full}</span> and all of its data will be permanently deleted. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-drop" className="text-xs text-muted-foreground">
              Type <span className="font-mono text-foreground">{name}</span> to confirm
            </Label>
            <Input id="confirm-drop" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} autoComplete="off" className="font-mono" />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={cascade} onCheckedChange={(v) => setCascade(v === true)} />
            <span>
              Cascade
              <span className="block text-xs text-muted-foreground">Also drop views and foreign keys that depend on it.</span>
            </span>
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={typed !== name || pending} onClick={() => onConfirm(cascade)}>
            {pending && <Spinner className="text-current" />}
            Drop {word}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
