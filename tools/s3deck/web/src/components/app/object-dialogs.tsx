import { zodResolver } from '@hookform/resolvers/zod';
import { MAX_PRESIGN_SECONDS, MAX_TAGS } from '@shared/constants';
import { metadataSchema, objectKeySchema, prefixSchema, tagSchema } from '@shared/schemas';
import type { Entry, ObjectEntry, SummaryResponse, Tag } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorText } from '@/api/client';
import { objectApi, useBucketMutation, useBuckets, useObjectDetails, useTags } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ErrorAlert } from './bucket-dialogs';
import { FormField } from './form-field';
import { formatBytes, formatDate, formatNumber, NO_PUBLIC_URL_HINT } from '@/lib/format';
import { useApp } from './app-context';

interface DialogProps {
  bucket: string;
  onClose: () => void;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error('Copy failed. Select the text and copy it manually.');
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* New folder                                                          */
/* ------------------------------------------------------------------ */

const folderNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .refine((v) => !v.startsWith('/') && !v.includes('//'), 'No leading or double slashes'),
});

export function NewFolderDialog({
  bucket,
  prefix,
  onClose,
  onCreated,
}: DialogProps & { prefix: string; onCreated: (p: string) => void }) {
  const form = useForm<z.infer<typeof folderNameSchema>>({
    resolver: zodResolver(folderNameSchema),
    defaultValues: { name: '' },
  });
  const create = useBucketMutation(bucket, (p: string) => objectApi.createFolder(bucket, p));
  const { errors } = form.formState;

  const submit = form.handleSubmit(({ name }) => {
    const full = `${prefix}${name.replace(/\/+$/, '')}/`;
    const check = prefixSchema.safeParse(full);
    if (!check.success) return form.setError('name', { message: check.error.issues[0]?.message });
    create.mutate(full, { onSuccess: () => (onCreated(full), onClose()) });
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              In{' '}
              <span className="font-mono">
                {bucket}/{prefix}
              </span>
            </DialogDescription>
          </DialogHeader>
          <FormField
            label="Folder name"
            htmlFor="folder-name"
            error={errors.name?.message}
            description='Use "/" to create nested folders'
          >
            <Input id="folder-name" autoFocus {...form.register('name')} aria-invalid={!!errors.name} />
          </FormField>
          {create.isError && <ErrorAlert error={create.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

export function DeleteDialog({
  bucket,
  entries,
  onClose,
  onDeleted,
}: DialogProps & { entries: Entry[]; onDeleted: () => void }) {
  const keys = entries.filter((e): e is ObjectEntry => e.type === 'object');
  const prefixes = entries.filter((e) => e.type === 'folder').map((e) => e.key);
  const knownBytes = keys.reduce((a, k) => a + k.size, 0);

  // Folders: count what's inside before asking.
  const summary = useQuery({
    queryKey: ['summary', bucket, prefixes],
    queryFn: ({ signal }) => objectApi.summary(bucket, { prefixes }, signal),
    enabled: prefixes.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
  const total: SummaryResponse | null =
    prefixes.length === 0
      ? { objects: keys.length, bytes: knownBytes }
      : summary.data
        ? { objects: summary.data.objects + keys.length, bytes: summary.data.bytes + knownBytes }
        : null;

  const del = useBucketMutation(bucket, () => objectApi.delete(bucket, { keys: keys.map((k) => k.key), prefixes }));

  const title = entries.length === 1 ? `Delete “${entries[0]!.name}”?` : `Delete ${entries.length} items?`;

  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-all">{title}</DialogTitle>
          <DialogDescription>
            {prefixes.length > 0 ? 'Everything inside the selected folders is deleted too. ' : ''}
            On versioned buckets, older versions are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {total ? (
            <>
              <span className="font-medium">{formatNumber(total.objects)}</span> object{total.objects === 1 ? '' : 's'}{' '}
              · <span className="font-medium">{formatBytes(total.bytes)}</span>
            </>
          ) : summary.isError ? (
            <span className="text-destructive">Couldn’t count objects: {errorText(summary.error)}</span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Counting objects…
            </span>
          )}
        </div>
        {del.isError && <ErrorAlert error={del.error} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending || (prefixes.length > 0 && !summary.data)}
            onClick={() =>
              del.mutate(undefined, {
                onSuccess: (r) => {
                  if (r.errors.length)
                    toast.error(`${r.errors.length} objects could not be deleted`, {
                      description: r.errors[0]?.message,
                    });
                  else toast.success(`Deleted ${formatNumber(r.deleted)} object${r.deleted === 1 ? '' : 's'}`);
                  onDeleted();
                  onClose();
                },
              })
            }
          >
            {del.isPending && <Spinner />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Rename                                                              */
/* ------------------------------------------------------------------ */

export function RenameDialog({ bucket, entry, onClose }: DialogProps & { entry: Entry }) {
  const parent = entry.key.slice(0, entry.key.length - entry.name.length - (entry.type === 'folder' ? 1 : 0));
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const move = useBucketMutation(bucket, (destination: string) =>
    objectApi.copy(bucket, { destinationBucket: bucket, move: true, items: [{ source: entry.key, destination }] }),
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim().replace(/\/+$/, '');
    if (!clean) return setError('Name is required');
    if (clean.includes('/')) return setError('Use Move to change folders');
    const destination = `${parent}${clean}${entry.type === 'folder' ? '/' : ''}`;
    const check = objectKeySchema.safeParse(destination);
    if (!check.success) return setError(check.error.issues[0]?.message ?? 'Invalid name');
    if (destination === entry.key) return onClose();
    move.mutate(destination, {
      onSuccess: () => {
        toast.success('Renamed');
        onClose();
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !move.isPending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Rename {entry.type}</DialogTitle>
            <DialogDescription>
              {entry.type === 'folder'
                ? 'Every object in the folder is copied to the new name, then the originals are deleted.'
                : 'The object is copied to the new name server-side, then the original is deleted.'}
            </DialogDescription>
          </DialogHeader>
          <FormField label="Name" htmlFor="rename" error={error ?? undefined}>
            <Input
              id="rename"
              value={name}
              autoFocus
              onFocus={(e) => {
                const dot = entry.type === 'object' ? e.target.value.lastIndexOf('.') : -1;
                e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
              }}
              onChange={(e) => (setName(e.target.value), setError(null))}
            />
          </FormField>
          {move.isError && <ErrorAlert error={move.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={move.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={move.isPending}>
              {move.isPending && <Spinner />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Copy / move                                                         */
/* ------------------------------------------------------------------ */

export function CopyMoveDialog({
  bucket,
  prefix,
  entries,
  onClose,
}: DialogProps & { prefix: string; entries: Entry[] }) {
  const buckets = useBuckets();
  const { readonly } = useApp();
  const [destBucket, setDestBucket] = useState(bucket);
  const [destPrefix, setDestPrefix] = useState(prefix);
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [error, setError] = useState<string | null>(null);

  const run = useBucketMutation(
    bucket,
    (input: { destinationBucket: string; move: boolean; items: { source: string; destination: string }[] }) =>
      objectApi.copy(bucket, input),
    (input) => [input.destinationBucket],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = destPrefix.trim().replace(/^\/+/, '');
    const normalized = target && !target.endsWith('/') ? `${target}/` : target;
    const items = entries.map((en) => ({
      source: en.key,
      destination: `${normalized}${en.name}${en.type === 'folder' ? '/' : ''}`,
    }));
    for (const i of items) {
      const check = objectKeySchema.safeParse(i.destination);
      if (!check.success) return setError(check.error.issues[0]?.message ?? 'Invalid destination');
      if (i.source.endsWith('/') && destBucket === bucket && i.destination.startsWith(i.source)) {
        return setError('A folder can’t be copied into itself');
      }
    }
    if (destBucket === bucket && items.every((i) => i.source === i.destination)) {
      return setError('Pick a different destination');
    }
    run.mutate(
      { destinationBucket: destBucket, move: mode === 'move', items },
      {
        onSuccess: (r) => {
          toast.success(
            `${mode === 'move' ? 'Moved' : 'Copied'} ${formatNumber(r.copied)} object${r.copied === 1 ? '' : 's'}`,
          );
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              Copy or move {entries.length === 1 ? `“${entries[0]!.name}”` : `${entries.length} items`}
            </DialogTitle>
            <DialogDescription>Server-side copy: nothing passes through your machine.</DialogDescription>
          </DialogHeader>
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(v) => v && setMode(v as 'copy' | 'move')}
            disabled={readonly}
            className="w-full"
          >
            <ToggleGroupItem value="copy" className="flex-1">
              Copy
            </ToggleGroupItem>
            <ToggleGroupItem value="move" className="flex-1">
              Move
            </ToggleGroupItem>
          </ToggleGroup>
          <FormField label="Destination bucket" htmlFor="dest-bucket">
            <Select value={destBucket} onValueChange={setDestBucket}>
              <SelectTrigger id="dest-bucket" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(buckets.data?.buckets ?? [{ name: bucket }]).map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Destination folder"
            htmlFor="dest-prefix"
            description="Empty for the bucket root"
            error={error ?? undefined}
          >
            <Input
              id="dest-prefix"
              value={destPrefix}
              placeholder="path/to/folder/"
              onChange={(e) => (setDestPrefix(e.target.value), setError(null))}
              className="font-mono"
            />
          </FormField>
          {run.isError && <ErrorAlert error={run.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={run.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={run.isPending}>
              {run.isPending && <Spinner />}
              {mode === 'move' ? 'Move' : 'Copy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Share                                                               */
/* ------------------------------------------------------------------ */

const EXPIRY = [
  { label: '15 minutes', s: 15 * 60 },
  { label: '1 hour', s: 3600 },
  { label: '6 hours', s: 6 * 3600 },
  { label: '1 day', s: 86400 },
  { label: '3 days', s: 3 * 86400 },
  { label: '7 days', s: MAX_PRESIGN_SECONDS },
];

export function ShareDialog({
  bucket,
  objectKey,
  versionId,
  onClose,
}: DialogProps & { objectKey: string; versionId?: string | null }) {
  const { readonly } = useApp();
  const details = useObjectDetails(bucket, objectKey, versionId);
  const [expiresIn, setExpiresIn] = useState(3600);
  const [tab, setTab] = useState<'download' | 'upload' | 'public'>('download');
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link is for one mode and lifetime; changing either discards it.
  const [linkFor, setLinkFor] = useState({ tab, expiresIn });
  if (linkFor.tab !== tab || linkFor.expiresIn !== expiresIn) {
    setLinkFor({ tab, expiresIn });
    setLink(null);
  }

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(
        await objectApi.presign(bucket, {
          key: objectKey,
          method: tab === 'upload' ? 'PUT' : 'GET',
          expiresIn,
          versionId: tab === 'download' ? (versionId ?? undefined) : undefined,
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{objectKey}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="download">Download link</TabsTrigger>
            {!readonly && <TabsTrigger value="upload">Upload link</TabsTrigger>}
            <TabsTrigger value="public">Public URL</TabsTrigger>
          </TabsList>
          {(['download', 'upload'] as const).map((t) => (
            <TabsContent key={t} value={t} className="grid gap-4 pt-4">
              <p className="text-sm text-muted-foreground">
                {t === 'download'
                  ? 'Anyone with this link can download the object until it expires.'
                  : 'Anyone with this link can upload one file to this exact key (HTTP PUT) until it expires, replacing the current object.'}
              </p>
              <div className="flex items-end gap-2">
                <FormField label="Expires after" htmlFor={`expiry-${t}`} className="flex-1">
                  <Select value={String(expiresIn)} onValueChange={(v) => setExpiresIn(Number(v))}>
                    <SelectTrigger id={`expiry-${t}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY.map((x) => (
                        <SelectItem key={x.s} value={String(x.s)}>
                          {x.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <Button onClick={create} disabled={busy}>
                  {busy && <Spinner />}
                  Create link
                </Button>
              </div>
              {error && <ErrorAlert error={new Error(error)} />}
              {link && (
                <div className="grid gap-2">
                  <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Expires {formatDate(link.expiresAt)}</span>
                    <CopyButton text={link.url} label="Copy link" />
                  </div>
                  {t === 'upload' && (
                    <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{`curl -X PUT -T ./file '${link.url}'`}</pre>
                  )}
                </div>
              )}
            </TabsContent>
          ))}
          <TabsContent value="public" className="grid gap-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Works only if the bucket or object is public. Set a public URL base on the connection to use your own
              domain.
            </p>
            {details.data && !details.data.publicUrl ? (
              <p className="rounded-md border border-dashed p-3 text-sm">{NO_PUBLIC_URL_HINT}</p>
            ) : details.data?.publicUrl ? (
              <>
                <Input
                  readOnly
                  value={details.data.publicUrl}
                  className="font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <div className="flex justify-end">
                  <CopyButton text={details.data.publicUrl} label="Copy URL" />
                </div>
              </>
            ) : (
              <Spinner />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

const metaFormSchema = z.object({
  contentType: metadataSchema.shape.contentType.unwrap(),
  cacheControl: metadataSchema.shape.cacheControl.unwrap(),
  contentDisposition: metadataSchema.shape.contentDisposition.unwrap(),
  contentEncoding: metadataSchema.shape.contentEncoding.unwrap(),
  replaceMetadata: z.boolean(),
  meta: z
    .array(
      z.object({ key: z.string().regex(/^[a-zA-Z0-9-_]*$/, 'Letters, digits, - and _'), value: z.string().max(2048) }),
    )
    .refine((rows) => {
      const keys = rows.map((r) => r.key.toLowerCase()).filter(Boolean);
      return new Set(keys).size === keys.length;
    }, 'Keys must be unique'),
});
type MetaForm = z.infer<typeof metaFormSchema>;

export function MetadataDialog({ bucket, keys, onClose }: DialogProps & { keys: string[] }) {
  const single = keys.length === 1;
  const details = useObjectDetails(bucket, single ? keys[0]! : null);
  const save = useBucketMutation(bucket, (input: z.infer<typeof metadataSchema>) => objectApi.metadata(bucket, input));
  const form = useForm<MetaForm>({
    resolver: zodResolver(metaFormSchema),
    defaultValues: {
      contentType: '',
      cacheControl: '',
      contentDisposition: '',
      contentEncoding: '',
      replaceMetadata: single,
      meta: [],
    },
  });
  const rows = useFieldArray({ control: form.control, name: 'meta' });
  const { errors } = form.formState;

  useEffect(() => {
    const d = details.data;
    if (!d) return;
    form.reset({
      contentType: d.contentType ?? '',
      cacheControl: d.cacheControl ?? '',
      contentDisposition: d.contentDisposition ?? '',
      contentEncoding: d.contentEncoding ?? '',
      replaceMetadata: true,
      meta: Object.entries(d.metadata).map(([key, value]) => ({ key, value })),
    });
  }, [details.data, form]);

  const submit = form.handleSubmit((v) => {
    // With several objects, blank fields mean "leave as is".
    const field = (val: string, dirty: boolean | undefined) => (single ? val : dirty ? val : undefined);
    const dirty = form.formState.dirtyFields;
    const input = {
      keys,
      contentType: field(v.contentType, dirty.contentType),
      cacheControl: field(v.cacheControl, dirty.cacheControl),
      contentDisposition: field(v.contentDisposition, dirty.contentDisposition),
      contentEncoding: field(v.contentEncoding, dirty.contentEncoding),
      metadata: v.replaceMetadata
        ? Object.fromEntries(v.meta.filter((r) => r.key).map((r) => [r.key, r.value]))
        : undefined,
    };
    const parsed = metadataSchema.safeParse(input);
    if (!parsed.success) return form.setError('root', { message: parsed.error.issues[0]?.message });
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(`Updated ${keys.length} object${single ? '' : 's'}`);
        onClose();
      },
    });
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Edit metadata</DialogTitle>
            <DialogDescription>
              {single ? (
                <span className="break-all font-mono text-xs">{keys[0]}</span>
              ) : (
                `${keys.length} objects. Only fields you change are applied.`
              )}
            </DialogDescription>
          </DialogHeader>
          {single && details.isPending ? (
            <Spinner />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Content-Type" htmlFor="m-ct" error={errors.contentType?.message}>
                  <Input id="m-ct" placeholder="image/png" {...form.register('contentType')} />
                </FormField>
                <FormField label="Cache-Control" htmlFor="m-cc" error={errors.cacheControl?.message}>
                  <Input id="m-cc" placeholder="public, max-age=3600" {...form.register('cacheControl')} />
                </FormField>
                <FormField label="Content-Disposition" htmlFor="m-cd" error={errors.contentDisposition?.message}>
                  <Input id="m-cd" placeholder="attachment" {...form.register('contentDisposition')} />
                </FormField>
                <FormField label="Content-Encoding" htmlFor="m-ce" error={errors.contentEncoding?.message}>
                  <Input id="m-ce" placeholder="gzip" {...form.register('contentEncoding')} />
                </FormField>
              </div>
              <FieldSet className="gap-2">
                <div className="flex items-center justify-between">
                  <FieldLegend variant="label" className="mb-0">
                    Custom metadata (x-amz-meta-*)
                  </FieldLegend>
                  {!single && (
                    <Field orientation="horizontal" className="w-auto">
                      <Controller
                        control={form.control}
                        name="replaceMetadata"
                        render={({ field }) => (
                          <Checkbox
                            id="replace-meta"
                            checked={field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        )}
                      />
                      <FieldLabel htmlFor="replace-meta" className="text-xs font-normal">
                        Replace on all objects
                      </FieldLabel>
                    </Field>
                  )}
                </div>
                {rows.fields.map((f, i) => (
                  <div key={f.id} className="flex gap-2">
                    <Input
                      placeholder="key"
                      className="font-mono text-xs"
                      {...form.register(`meta.${i}.key`)}
                      aria-invalid={!!errors.meta?.[i]?.key}
                    />
                    <Input placeholder="value" className="font-mono text-xs" {...form.register(`meta.${i}.value`)} />
                    <Button variant="ghost" size="icon" onClick={() => rows.remove(i)} aria-label="Remove field">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => rows.append({ key: '', value: '' })}
                >
                  <Plus /> Add field
                </Button>
                <FieldError>{errors.meta?.root?.message ?? errors.meta?.message}</FieldError>
              </FieldSet>
            </>
          )}
          {errors.root?.message && <ErrorAlert error={new Error(errors.root.message)} />}
          {save.isError && <ErrorAlert error={save.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

const tagsFormSchema = z.object({
  tags: z
    .array(tagSchema)
    .max(MAX_TAGS, `At most ${MAX_TAGS} tags`)
    .refine((t) => new Set(t.map((x) => x.Key)).size === t.length, 'Tag keys must be unique'),
});

export function TagsEditor({ bucket, keys, onDone }: { bucket: string; keys: string[]; onDone?: () => void }) {
  const single = keys.length === 1;
  const existing = useTags(bucket, keys[0]!, single);
  const save = useBucketMutation(bucket, (tags: Tag[]) => objectApi.tags(bucket, { keys, tags }));
  const form = useForm<{ tags: Tag[] }>({ resolver: zodResolver(tagsFormSchema), defaultValues: { tags: [] } });
  const rows = useFieldArray({ control: form.control, name: 'tags' });
  const { errors } = form.formState;

  useEffect(() => {
    if (existing.data) form.reset({ tags: existing.data.tags });
  }, [existing.data, form]);

  if (single && existing.isPending) return <Spinner />;
  if (single && existing.isError) return <ErrorAlert error={existing.error} />;

  return (
    <form
      noValidate
      className="grid gap-2"
      onSubmit={form.handleSubmit((v) =>
        save.mutate(v.tags, {
          onSuccess: () => {
            toast.success('Tags saved');
            onDone?.();
          },
        }),
      )}
    >
      {!single && (
        <p className="text-sm text-muted-foreground">These tags replace the tags on all {keys.length} objects.</p>
      )}
      {rows.fields.length === 0 && <p className="text-sm text-muted-foreground">No tags.</p>}
      {rows.fields.map((f, i) => (
        <div key={f.id} className="flex gap-2">
          <Input
            placeholder="Key"
            className="text-xs"
            {...form.register(`tags.${i}.Key`)}
            aria-invalid={!!errors.tags?.[i]?.Key}
          />
          <Input
            placeholder="Value"
            className="text-xs"
            {...form.register(`tags.${i}.Value`)}
            aria-invalid={!!errors.tags?.[i]?.Value}
          />
          <Button variant="ghost" size="icon" onClick={() => rows.remove(i)} aria-label="Remove tag">
            <Trash2 />
          </Button>
        </div>
      ))}
      <FieldError>{errors.tags?.root?.message ?? errors.tags?.message}</FieldError>
      {save.isError && <ErrorAlert error={save.error} />}
      <div className="flex justify-between gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          disabled={rows.fields.length >= MAX_TAGS}
          onClick={() => rows.append({ Key: '', Value: '' })}
        >
          <Plus /> Add tag
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          Save tags
        </Button>
      </div>
    </form>
  );
}

export function TagsDialog({ bucket, keys, onClose }: DialogProps & { keys: string[] }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
          <DialogDescription>
            {keys.length === 1 ? (
              <span className="break-all font-mono text-xs">{keys[0]}</span>
            ) : (
              `${keys.length} objects`
            )}
          </DialogDescription>
        </DialogHeader>
        <TagsEditor bucket={bucket} keys={keys} onDone={onClose} />
      </DialogContent>
    </Dialog>
  );
}
