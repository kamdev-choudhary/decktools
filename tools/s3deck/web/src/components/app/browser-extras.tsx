import type { DeletedEntry, Entry } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Folder, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { downloadUrl, errorText } from '@/api/client';
import { invalidateBucket, moreObjectApi, objectApi, useBucketMutation, useFolderSize } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TableCell, TableRow } from '@/components/ui/table';
import { iconFor, previewKind } from '@/lib/file-types';
import { formatBytes, formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorAlert } from './bucket-dialogs';
import { FormField } from './form-field';
import { IconButton } from './icon-button';

/** dataTransfer type for dragging objects onto folders (moves them). */
export const DRAG_TYPE = 'application/x-s3deck-move';

export const ARCHIVE_CLASSES = new Set(['GLACIER', 'DEEP_ARCHIVE']);

const CLASS_LABELS: Record<string, string> = {
  STANDARD: 'Standard',
  INTELLIGENT_TIERING: 'Intelligent-Tiering',
  STANDARD_IA: 'Standard-IA (infrequent access)',
  ONEZONE_IA: 'One Zone-IA',
  GLACIER_IR: 'Glacier Instant Retrieval',
  GLACIER: 'Glacier Flexible Retrieval (archive)',
  DEEP_ARCHIVE: 'Glacier Deep Archive (archive)',
};

export function StorageClassBadge({ value }: { value: string | null }) {
  if (!value) return null;
  if (ARCHIVE_CLASSES.has(value)) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Archive className="size-3" /> Archived
      </Badge>
    );
  }
  return <span>{value}</span>;
}

/* ------------------------------------------------------------------ */
/* Folder size, on demand                                              */
/* ------------------------------------------------------------------ */

export function FolderSizeCell({ bucket, prefix }: { bucket: string; prefix: string }) {
  const [requested, setRequested] = useState(false);
  const size = useFolderSize(bucket, prefix, requested);
  if (!requested) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="-mr-2 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          setRequested(true);
        }}
      >
        Calculate
      </Button>
    );
  }
  if (size.isPending) return <Spinner className="ml-auto size-3.5 text-muted-foreground" />;
  if (size.isError) return <span title={errorText(size.error)}>—</span>;
  return <span title={`${size.data.objects.toLocaleString()} objects`}>{formatBytes(size.data.bytes)}</span>;
}

/* ------------------------------------------------------------------ */
/* Deleted objects (versioned buckets)                                 */
/* ------------------------------------------------------------------ */

export function DeletedRows({
  bucket,
  entries,
  readonly,
}: {
  bucket: string;
  entries: DeletedEntry[];
  readonly: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (d: DeletedEntry) => {
    setBusy(d.key);
    try {
      // Removing the delete marker brings back the previous version.
      await objectApi.deleteVersion(bucket, d.key, d.markerVersionId);
      toast.success(`Restored ${d.name}`);
      await invalidateBucket(qc, bucket);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return entries.map((d) => {
    const Icon = iconFor(d.name);
    return (
      <TableRow key={`deleted:${d.key}`} className="text-muted-foreground hover:bg-transparent">
        <TableCell className="pl-4" />
        <TableCell>
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0 opacity-60" />
            <span className="truncate line-through decoration-muted-foreground/50" title={d.key}>
              {d.name}
            </span>
            <Badge variant="outline">deleted</Badge>
          </span>
        </TableCell>
        <TableCell />
        <TableCell className="truncate" title={formatDate(d.deletedAt)}>
          {formatRelative(d.deletedAt)}
        </TableCell>
        <TableCell className="hidden md:table-cell" />
        <TableCell className="pr-4 text-right">
          {!readonly && (
            <IconButton label="Restore" disabled={busy === d.key} onClick={() => void restore(d)}>
              {busy === d.key ? <Spinner /> : <Undo2 />}
            </IconButton>
          )}
        </TableCell>
      </TableRow>
    );
  });
}

/* ------------------------------------------------------------------ */
/* Grid view                                                           */
/* ------------------------------------------------------------------ */

const THUMB_MAX_BYTES = 20 * 1024 * 1024;

export function GridView({
  bucket,
  rows,
  selected,
  openKey,
  focus,
  onOpen,
  onToggle,
  menu,
  dragProps,
  dropProps,
  dropTarget,
}: {
  bucket: string;
  rows: Entry[];
  selected: Set<string>;
  openKey: string | null;
  focus: number;
  onOpen: (e: Entry, index: number, ev: React.MouseEvent) => void;
  onToggle: (index: number, ev: { shiftKey?: boolean }) => void;
  menu: (e: Entry) => React.ReactNode;
  dragProps: (e: Entry) => React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  dropProps: (prefix: string) => React.HTMLAttributes<HTMLElement>;
  dropTarget: string | null;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 p-4">
      {rows.map((entry, index) => {
        const isSelected = selected.has(entry.key);
        const Icon = entry.type === 'folder' ? Folder : iconFor(entry.name);
        const thumb = entry.type === 'object' && previewKind(entry.name) === 'image' && entry.size <= THUMB_MAX_BYTES;
        return (
          <div
            key={entry.key}
            data-index={index}
            onClick={(e) => onOpen(entry, index, e)}
            {...dragProps(entry)}
            {...(entry.type === 'folder' ? dropProps(entry.key) : {})}
            className={cn(
              'group/row relative flex cursor-default flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/40',
              (isSelected || openKey === entry.key) && 'border-primary/60 bg-primary/5',
              focus === index && 'outline-2 -outline-offset-2 outline-ring/60',
              dropTarget === entry.key && 'border-primary bg-primary/10',
            )}
          >
            <div className="grid aspect-[4/3] place-items-center overflow-hidden bg-muted/50">
              {thumb ? (
                <img
                  src={downloadUrl(bucket, entry.key, { inline: true })}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover"
                />
              ) : (
                <Icon
                  className={cn(
                    'size-10',
                    entry.type === 'folder' ? 'fill-primary/15 text-primary' : 'text-muted-foreground',
                  )}
                />
              )}
            </div>
            <div className="flex items-center gap-1 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={entry.key}>
                  {entry.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.type === 'object'
                    ? `${formatBytes(entry.size)} · ${formatRelative(entry.lastModified)}`
                    : 'Folder'}
                </p>
              </div>
              <div onClick={(e) => e.stopPropagation()}>{menu(entry)}</div>
            </div>
            <Checkbox
              checked={isSelected}
              onClick={(e) => (e.stopPropagation(), onToggle(index, e))}
              aria-label={`Select ${entry.name}`}
              className={cn(
                'absolute top-2 left-2 bg-background',
                isSelected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Storage class & archive restore dialogs                             */
/* ------------------------------------------------------------------ */

export function StorageClassDialog({
  bucket,
  keys,
  classes,
  onClose,
}: {
  bucket: string;
  keys: string[];
  classes: string[];
  onClose: () => void;
}) {
  const [value, setValue] = useState(classes[1] ?? classes[0] ?? 'STANDARD');
  const run = useBucketMutation(bucket, () => moreObjectApi.storageClass(bucket, keys, value));
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change storage class</DialogTitle>
          <DialogDescription>
            {keys.length === 1 ? (
              <span className="font-mono text-xs break-all">{keys[0]}</span>
            ) : (
              `${keys.length} objects`
            )}{' '}
            are rewritten in place with the new class. Headers and metadata are kept.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <FormField
            label="Storage class"
            htmlFor="storage-class"
            description={
              ARCHIVE_CLASSES.has(value)
                ? 'Archived objects must be restored before they can be downloaded.'
                : undefined
            }
          >
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger id="storage-class" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CLASS_LABELS[c] ?? c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {run.isError && <ErrorAlert error={run.error} />}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            disabled={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: () => {
                  toast.success(
                    `Moved ${keys.length} object${keys.length === 1 ? '' : 's'} to ${CLASS_LABELS[value] ?? value}`,
                  );
                  onClose();
                },
              })
            }
          >
            {run.isPending && <Spinner />}
            Change class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TIERS = [
  { value: 'Expedited', label: 'Expedited', hint: '1–5 minutes (Glacier Flexible only), highest cost' },
  { value: 'Standard', label: 'Standard', hint: '3–5 hours (12 hours for Deep Archive)' },
  { value: 'Bulk', label: 'Bulk', hint: '5–12 hours (48 hours for Deep Archive), lowest cost' },
] as const;

export function RestoreArchiveDialog({
  bucket,
  keys,
  onClose,
}: {
  bucket: string;
  keys: string[];
  onClose: () => void;
}) {
  const [tier, setTier] = useState<'Expedited' | 'Standard' | 'Bulk'>('Standard');
  const [days, setDays] = useState('7');
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;
  const run = useBucketMutation(bucket, () => moreObjectApi.restoreArchive(bucket, keys, daysNum, tier));

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore from archive</DialogTitle>
          <DialogDescription>
            Makes a temporary, downloadable copy of {keys.length === 1 ? 'this object' : `${keys.length} objects`}. The
            archived original stays where it is.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <FormField label="Retrieval speed" htmlFor="tier" description={TIERS.find((t) => t.value === tier)?.hint}>
            <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
              <SelectTrigger id="tier" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Keep the copy for (days)"
            htmlFor="days"
            error={daysValid ? undefined : 'Between 1 and 365 days'}
          >
            <Input
              id="days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-invalid={!daysValid}
            />
          </FormField>
          {run.isError && <ErrorAlert error={run.error} />}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            disabled={run.isPending || !daysValid}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: () => {
                  toast.success('Restore requested', {
                    description: 'The object can be downloaded once the restore finishes.',
                  });
                  onClose();
                },
              })
            }
          >
            {run.isPending && <Spinner />}
            Request restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
