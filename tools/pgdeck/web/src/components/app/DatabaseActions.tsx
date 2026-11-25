import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, CopyPlus, Database, MoreHorizontal, PencilLine, Plus, Table2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { keys, useDatabases, useInfo } from '@/api/hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@deck/ui/components/alert-dialog';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deck/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@deck/ui/components/dropdown-menu';
import { Input } from '@deck/ui/components/input';
import { Label } from '@deck/ui/components/label';
import { dbHref, navigate } from '@/lib/router';
import { Combobox } from '@deck/ui/components/combobox';
import { CreateTableDialog } from './CreateTableDialog';
import { errorMessage, Spinner } from './feedback';

const NAME_OK = (s: string) => s.trim().length > 0 && s.trim().length <= 63;

/** Create a database, empty or as a copy of another one. */
export function CreateDatabaseDialog({ copyOf, onClose }: { copyOf?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const databases = useDatabases();
  const [name, setName] = useState(copyOf ? `${copyOf}_copy` : '');
  const [template, setTemplate] = useState(copyOf ?? '');
  const def = databases.data?.default;
  const options = [
    { value: '', label: 'Empty database' },
    ...(databases.data?.databases ?? []).filter((d) => d.name !== def).map((d) => ({ value: d.name, label: `Copy of ${d.name}`, hint: d.size })),
  ];

  const create = useMutation({
    mutationFn: () => api.createDatabase({ name: name.trim(), template: template || undefined }),
    onSuccess: async (res) => {
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: keys.databases });
      navigate(dbHref(name.trim()));
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (NAME_OK(name)) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{copyOf ? 'Copy database' : 'New database'}</DialogTitle>
            <DialogDescription>Created on the same server, owned by the user pgdeck connects as.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="db-name">Name</Label>
            <Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. app_staging" autoFocus spellCheck={false} autoComplete="off" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>Start from</Label>
            <Combobox value={template} onChange={setTemplate} options={options} placeholder="Empty database" className="h-9 w-full text-sm" aria-label="Start from" />
            {template && (
              <p className="text-xs text-muted-foreground">
                Copies schema and data of <span className="font-mono text-foreground">{template}</span>. Postgres needs it to have no other open connections while copying.
              </p>
            )}
          </div>
          {create.isError && <p className="text-sm text-destructive">{errorMessage(create.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!NAME_OK(name) || create.isPending}>
              {create.isPending && <Spinner className="text-current" />}
              {template ? 'Copy database' : 'Create database'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDatabaseDialog({ db, onClose }: { db: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(db);
  const rename = useMutation({
    mutationFn: () => api.databaseAction({ action: 'rename', name: db, newName: name.trim() }),
    onSuccess: async (res) => {
      toast.success(res.message);
      navigate(dbHref(name.trim()), true);
      qc.removeQueries({ queryKey: keys.db(db) });
      await qc.invalidateQueries({ queryKey: keys.databases });
      onClose();
    },
  });
  const valid = NAME_OK(name) && name.trim() !== db;
  return (
    <Dialog open onOpenChange={(o) => !o && !rename.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) rename.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename database</DialogTitle>
            <DialogDescription>
              Other sessions connected to <span className="font-mono text-foreground">{db}</span> must disconnect first, or Postgres will refuse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="db-rename">New name</Label>
            <Input id="db-rename" value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} autoComplete="off" className="font-mono" />
          </div>
          {rename.isError && <p className="text-sm text-destructive">{errorMessage(rename.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={rename.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || rename.isPending}>
              {rename.isPending && <Spinner className="text-current" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DropDatabaseDialog({ db, fallback, onClose }: { db: string; fallback: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [force, setForce] = useState(false);
  const drop = useMutation({
    mutationFn: () => api.databaseAction({ action: 'drop', name: db, force }),
    onSuccess: async (res) => {
      toast.success(res.message);
      navigate(dbHref(fallback), true);
      qc.removeQueries({ queryKey: keys.db(db) });
      await qc.invalidateQueries({ queryKey: keys.databases });
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && !drop.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop database?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-foreground">{db}</span> and every table, view and row in it will be permanently deleted. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-db-drop" className="text-xs text-muted-foreground">
              Type <span className="font-mono text-foreground">{db}</span> to confirm
            </Label>
            <Input id="confirm-db-drop" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} autoComplete="off" className="font-mono" />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={force} onCheckedChange={(v) => setForce(v === true)} />
            <span>
              Disconnect other sessions
              <span className="block text-xs text-muted-foreground">Terminates anyone still connected (PostgreSQL 13+). Otherwise the drop fails while they are.</span>
            </span>
          </label>
          {drop.isError && <p className="text-sm text-destructive">{errorMessage(drop.error)}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={drop.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={typed !== db || drop.isPending} onClick={() => drop.mutate()}>
            {drop.isPending && <Spinner className="text-current" />}
            Drop database
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type DbDialog = 'new-table' | 'new-db' | 'copy' | 'rename' | 'drop' | null;

/** ⋯ menu for the current database: new table, new / copy / rename / drop database. */
export function DatabaseActionsMenu({ db }: { db: string }) {
  const info = useInfo(db);
  const databases = useDatabases();
  const [dialog, setDialog] = useState<DbDialog>(null);
  const readonly = info.data?.readonly ?? false;
  const def = databases.data?.default ?? '';
  const isDefault = db === def;
  const defaultNote = 'pgdeck connects through this database, so it can’t be changed here';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="Database actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="truncate font-mono text-xs font-normal text-muted-foreground" title={db}>
            {db}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(db).then(() => toast.success('Copied database name'))}>
            <Copy /> Copy name
          </DropdownMenuItem>
          {!readonly && (
            <>
              <DropdownMenuItem onSelect={() => setDialog('new-table')}>
                <Table2 /> New table…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog('new-db')}>
                <Plus /> New database…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isDefault} title={isDefault ? defaultNote : undefined} onSelect={() => setDialog('copy')}>
                <CopyPlus /> Copy database…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isDefault} title={isDefault ? defaultNote : undefined} onSelect={() => setDialog('rename')}>
                <PencilLine /> Rename database…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={isDefault} title={isDefault ? defaultNote : undefined} onSelect={() => setDialog('drop')}>
                <Trash2 /> Drop database…
              </DropdownMenuItem>
              {isDefault && (
                <p className="flex gap-1.5 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                  <Database className="mt-px size-3 shrink-0" />
                  This is pgdeck’s connection database, so it can’t be copied, renamed or dropped from here.
                </p>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'new-table' && <CreateTableDialog db={db} onClose={() => setDialog(null)} />}
      {dialog === 'new-db' && <CreateDatabaseDialog onClose={() => setDialog(null)} />}
      {dialog === 'copy' && <CreateDatabaseDialog copyOf={db} onClose={() => setDialog(null)} />}
      {dialog === 'rename' && <RenameDatabaseDialog db={db} onClose={() => setDialog(null)} />}
      {dialog === 'drop' && <DropDatabaseDialog db={db} fallback={def} onClose={() => setDialog(null)} />}
    </>
  );
}
