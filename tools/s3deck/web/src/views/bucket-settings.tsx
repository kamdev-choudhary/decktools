import { corsSchema, formatZodError, lifecycleSchema, policySchema, publicAccessBlockSchema } from '@shared/schemas';
import type { BucketSettings, MultipartUploadInfo, Setting } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChartColumn,
  ChevronRight,
  CircleAlert,
  Clock,
  Database,
  FileJson,
  Globe,
  Info,
  Lock,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Trash2,
  Upload,
  Workflow,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ZodType } from 'zod';
import { errorText } from '@/api/client';
import { moreObjectApi, qk, useBucketSettings, useIncompleteUploads, useSaveSetting, useUsage } from '@/api/hooks';
import { useApp } from '@/components/app/app-context';
import { DeleteBucketDialog } from '@/components/app/bucket-dialogs';
import { IconButton } from '@/components/app/icon-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes, formatNumber, formatRelative } from '@/lib/format';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

type SectionId = 'general' | 'versioning' | 'cors' | 'lifecycle' | 'policy' | 'public' | 'uploads' | 'usage';

const EXAMPLES = {
  cors: [{ AllowedOrigins: ['https://example.com'], AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], MaxAgeSeconds: 3600 }],
  lifecycle: [
    {
      ID: 'expire-tmp',
      Status: 'Enabled',
      Filter: { Prefix: 'tmp/' },
      Expiration: { Days: 7 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 },
    },
  ],
  policy: (bucket: string) => ({
    Version: '2012-10-17',
    Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` }],
  }),
};

/** IAM action needed to read each setting, for permission hints. */
const READ_PERMISSION: Record<string, string> = {
  versioning: 's3:GetBucketVersioning',
  cors: 's3:GetBucketCORS',
  lifecycle: 's3:GetLifecycleConfiguration',
  policy: 's3:GetBucketPolicy',
  public: 's3:GetBucketPublicAccessBlock',
  uploads: 's3:ListBucketMultipartUploads',
};

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({ title, description, children }: { title: string; description: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** Shown when a setting couldn't be read (usually a missing IAM permission). Editing is locked. */
function ReadError({ what, section, error }: { what: string; section: SectionId; error: string }) {
  const denied = /denied|forbidden|403/i.test(error);
  return (
    <Alert variant="destructive" className="mb-6">
      <CircleAlert />
      <AlertTitle>Can’t read {what}</AlertTitle>
      <AlertDescription>
        <p>
          {denied ? (
            <>
              The access key isn’t allowed to read this setting
              {READ_PERMISSION[section] && (
                <>
                  {' '}
                  (needs <code className="rounded bg-destructive/10 px-1 font-mono text-xs">{READ_PERMISSION[section]}</code>)
                </>
              )}
              .
            </>
          ) : (
            error
          )}
        </p>
        <p>Editing is turned off so existing configuration isn’t overwritten by mistake.</p>
      </AlertDescription>
    </Alert>
  );
}

type Validation<T> = { state: 'empty' } | { state: 'valid'; value: T } | { state: 'invalid'; message: string };

function validateJson<T>(text: string, schema: ZodType<T>): Validation<T> {
  if (!text.trim()) return { state: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { state: 'invalid', message: `Invalid JSON: ${(e as Error).message}` };
  }
  const r = schema.safeParse(parsed);
  return r.success ? { state: 'valid', value: r.data } : { state: 'invalid', message: formatZodError(r.error) };
}

/** JSON editor with a file-style header, live zod validation and a save bar. */
function JsonEditor<T>({
  fileName,
  value,
  schema,
  example,
  locked,
  emptyLabel,
  countLabel,
  saving,
  onSave,
}: {
  fileName: string;
  value: unknown;
  schema: ZodType<T>;
  example: unknown;
  locked: boolean;
  emptyLabel: string;
  countLabel?: (v: T) => string;
  saving: boolean;
  onSave: (v: T | null) => void;
}) {
  const initial = value === null || (Array.isArray(value) && value.length === 0) ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(initial);
  // A saved or refreshed value replaces the draft.
  const [textFor, setTextFor] = useState(initial);
  if (textFor !== initial) {
    setTextFor(initial);
    setText(initial);
  }

  const result = useMemo(() => validateJson(text, schema), [text, schema]);
  const dirty = text !== initial;
  const canSave = !locked && dirty && result.state !== 'invalid' && !saving;

  const status =
    result.state === 'invalid' ? (
      <Badge variant="destructive">Invalid</Badge>
    ) : dirty ? (
      <Badge variant="secondary">Unsaved changes</Badge>
    ) : result.state === 'empty' ? (
      <Badge variant="outline">{emptyLabel}</Badge>
    ) : (
      <Badge variant="outline">{countLabel ? countLabel(result.value) : 'Configured'}</Badge>
    );

  return (
    <div className={cn('overflow-hidden rounded-lg border', result.state === 'invalid' && 'border-destructive/60')}>
      <div className="flex h-11 items-center gap-2 border-b bg-muted/40 px-3">
        <FileJson className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">{fileName}</span>
        {status}
        {!locked && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setText(JSON.stringify(example, null, 2))}>
              Insert example
            </Button>
            {result.state === 'valid' && (
              <Button variant="ghost" size="xs" onClick={() => setText(JSON.stringify(result.value, null, 2))}>
                Format
              </Button>
            )}
          </div>
        )}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={locked}
        spellCheck={false}
        placeholder={locked ? '' : `${emptyLabel}. Paste JSON here or insert an example.`}
        aria-invalid={result.state === 'invalid'}
        aria-label={fileName}
        className="min-h-80 resize-y rounded-none border-0 bg-transparent px-4 py-3 font-mono text-xs leading-relaxed focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
      />
      {!locked && (
        <div className="flex min-h-12 flex-wrap items-center gap-3 border-t bg-muted/40 px-3 py-2">
          <p className={cn('min-w-0 flex-1 text-xs', result.state === 'invalid' ? 'text-destructive' : 'text-muted-foreground')} role={result.state === 'invalid' ? 'alert' : undefined}>
            {result.state === 'invalid'
              ? result.message
              : result.state === 'empty' && initial
                ? `Saving an empty document removes the current configuration.`
                : 'Validated before saving.'}
          </p>
          <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setText(initial)}>
            Discard
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => result.state !== 'invalid' && onSave(result.state === 'valid' ? result.value : null)}>
            {saving && <Spinner />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

/** A bordered row with a title/description on the left and a control on the right. */
function SettingRow({ id, title, description, children }: { id: string; title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <FieldLabel htmlFor={id} className="rounded-none border-0">
      <Field orientation="horizontal" className="px-4 py-3.5">
        <FieldContent>
          <span className="text-sm font-medium">{title}</span>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        {children}
      </Field>
    </FieldLabel>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function summarize<T>(s: Setting<T>, fmt: (v: T) => string): { text: string; tone: 'muted' | 'error' | 'normal' } {
  if (!s.supported) return { text: 'Not supported', tone: 'muted' };
  if (s.error) return { text: 'No permission to read', tone: 'error' };
  return { text: fmt(s.value), tone: 'normal' };
}

function General({ bucket, settings, onOpen }: { bucket: string; settings: BucketSettings; onOpen: (id: SectionId) => void }) {
  const { connection, isAdmin, me } = useApp();
  const readonly = !isAdmin || me.readonly;
  const [deleting, setDeleting] = useState(false);
  const enc = settings.encryption;
  const lock = settings.objectLock;
  const pab = settings.publicAccessBlock.value;
  const plural = (n: number, w: string) => (n === 0 ? `No ${w}s` : `${formatNumber(n)} ${w}${n === 1 ? '' : 's'}`);

  const rows: { id: SectionId; label: string; summary: ReturnType<typeof summarize> }[] = [
    { id: 'versioning', label: 'Versioning', summary: summarize(settings.versioning, (v) => (v === 'Off' ? 'Never enabled' : v)) },
    { id: 'cors', label: 'CORS', summary: summarize(settings.cors, (v) => plural(v.length, 'rule')) },
    { id: 'lifecycle', label: 'Lifecycle', summary: summarize(settings.lifecycle, (v) => plural(v.length, 'rule')) },
    { id: 'policy', label: 'Bucket policy', summary: summarize(settings.policy, (v) => (v ? 'Configured' : 'None')) },
    {
      id: 'public',
      label: 'Public access',
      summary: summarize(settings.publicAccessBlock, () =>
        pab && Object.values(pab).every(Boolean) ? 'All public access blocked' : pab && Object.values(pab).some(Boolean) ? 'Partially blocked' : 'Not blocked',
      ),
    },
  ];

  return (
    <>
      <SectionHeader title="General" description="Where the bucket lives and how it’s configured. Select a row to change it." />
      <dl className="divide-y rounded-lg border">
        <div className="flex items-center gap-4 px-4 py-3 text-sm">
          <dt className="w-36 shrink-0 text-muted-foreground">Name</dt>
          <dd className="truncate font-mono text-xs">{bucket}</dd>
        </div>
        <div className="flex items-center gap-4 px-4 py-3 text-sm">
          <dt className="w-36 shrink-0 text-muted-foreground">Region</dt>
          <dd>{settings.region ?? connection.region}</dd>
        </div>
        <div className="flex items-center gap-4 px-4 py-3 text-sm">
          <dt className="w-36 shrink-0 text-muted-foreground">Provider</dt>
          <dd>{connection.providerName}</dd>
        </div>
        {enc.supported && (
          <div className="flex items-center gap-4 px-4 py-3 text-sm">
            <dt className="w-36 shrink-0 text-muted-foreground">Default encryption</dt>
            <dd className={cn('min-w-0', enc.error && 'text-destructive')}>
              {enc.error ? (
                'No permission to read'
              ) : enc.value ? (
                <>
                  {enc.value.algorithm}
                  {enc.value.kmsKeyId && <span className="block truncate font-mono text-xs text-muted-foreground">{enc.value.kmsKeyId}</span>}
                </>
              ) : (
                'None configured'
              )}
            </dd>
          </div>
        )}
        {lock.supported && !lock.error && (
          <div className="flex items-center gap-4 px-4 py-3 text-sm">
            <dt className="w-36 shrink-0 text-muted-foreground">Object lock</dt>
            <dd>
              {lock.value?.enabled
                ? lock.value.mode
                  ? `Enabled · default ${lock.value.mode} for ${lock.value.days ? `${lock.value.days} days` : `${lock.value.years} years`}`
                  : 'Enabled · no default retention'
                : 'Not enabled'}
            </dd>
          </div>
        )}
        {rows
          .filter((r) => r.summary.tone !== 'muted')
          .map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpen(r.id)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <dt className="w-36 shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className={cn('flex-1', r.summary.tone === 'error' && 'text-destructive')}>{r.summary.text}</dd>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
      </dl>

      {!readonly && connection.capabilities.bucketCreate && (
        <div className="mt-10">
          <h3 className="mb-3 text-sm font-semibold text-destructive">Danger zone</h3>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-destructive/40 px-4 py-3.5">
            <div>
              <p className="text-sm font-medium">Delete this bucket</p>
              <p className="text-sm text-muted-foreground">Permanently delete the bucket, optionally emptying it first.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete bucket
            </Button>
          </div>
          <DeleteBucketDialog bucket={bucket} open={deleting} onOpenChange={setDeleting} />
        </div>
      )}
    </>
  );
}

function Usage({ bucket }: { bucket: string }) {
  const [prefix, setPrefix] = useState('');
  const [run, setRun] = useState<{ prefix: string } | null>(null);
  const usage = useUsage(bucket, run?.prefix ?? '', !!run);
  const data = usage.data && !usage.isFetching ? usage.data : null;

  return (
    <>
      <SectionHeader
        title="Storage usage"
        description="Lists every object under a folder to add up sizes. Large buckets take a while and cost one LIST request per 1,000 objects."
      />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setRun({ prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix });
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <span className="font-mono text-xs">{bucket}/</span>
          </InputGroupAddon>
          <InputGroupInput value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="folder/ (empty for the whole bucket)" className="font-mono text-xs" />
        </InputGroup>
        <Button type="submit" disabled={usage.isFetching}>
          {usage.isFetching ? <Spinner /> : <ChartColumn />}
          Calculate
        </Button>
      </form>

      {usage.isFetching && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Counting objects… keep this tab open.
        </p>
      )}
      {usage.isError && (
        <Alert variant="destructive" className="mt-4">
          <CircleAlert />
          <AlertDescription>{errorText(usage.error)}</AlertDescription>
        </Alert>
      )}

      {data && (
        <div className="mt-6 space-y-6">
          <dl className="grid divide-y rounded-lg border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              ['Total size', formatBytes(data.bytes)],
              ['Objects', formatNumber(data.objects)],
              ['Calculated in', `${(data.durationMs / 1000).toFixed(1)}s`],
            ].map(([k, v]) => (
              <div key={k} className="px-4 py-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {[
            { title: 'By folder', rows: data.byFolder },
            { title: 'By storage class', rows: data.byStorageClass },
          ].map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-sm font-medium">{g.title}</h3>
              <div className="divide-y rounded-lg border">
                {g.rows.slice(0, 100).map((r) => (
                  <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-center gap-4 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{r.name}</p>
                      <Progress value={data.bytes ? Math.max(1, (r.bytes / data.bytes) * 100) : 0} className="mt-1.5 h-1" />
                    </div>
                    <span className="text-right tabular-nums">{formatBytes(r.bytes)}</span>
                    <span className="text-right text-muted-foreground tabular-nums">{formatNumber(r.objects)}</span>
                  </div>
                ))}
                {g.rows.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No objects.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function IncompleteUploads({ bucket }: { bucket: string }) {
  const { readonly } = useApp();
  const qc = useQueryClient();
  const uploads = useIncompleteUploads(bucket);
  const [busy, setBusy] = useState<string | null>(null);

  const abort = async (items: MultipartUploadInfo[]) => {
    setBusy(items.length === 1 ? items[0]!.uploadId : 'all');
    let failed = 0;
    for (const u of items) {
      try {
        await moreObjectApi.abortUpload(bucket, u.key, u.uploadId);
      } catch {
        failed++;
      }
    }
    setBusy(null);
    void qc.invalidateQueries({ queryKey: qk.incomplete(bucket) });
    if (failed) toast.error(`${failed} upload${failed === 1 ? '' : 's'} couldn’t be aborted`);
    else toast.success(`Aborted ${items.length} upload${items.length === 1 ? '' : 's'}`);
  };

  const list = uploads.data?.uploads ?? [];
  return (
    <>
      <SectionHeader
        title="Incomplete uploads"
        description="Multipart uploads that were started but never finished. Their parts take up storage (and cost money) until aborted."
      >
        {!readonly && list.length > 1 && (
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void abort(list)}>
            {busy === 'all' && <Spinner />} Abort all {list.length}
          </Button>
        )}
      </SectionHeader>
      {uploads.isError ? (
        <ReadError what="incomplete uploads" section="uploads" error={errorText(uploads.error)} />
      ) : uploads.isPending ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : list.length === 0 ? (
        <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">No incomplete uploads. Nothing to clean up.</div>
      ) : (
        <div className="divide-y rounded-lg border">
          {list.map((u) => (
            <div key={u.uploadId} className="flex items-center gap-4 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs" title={u.key}>
                  {u.key}
                </p>
                <p className="text-xs text-muted-foreground">Started {u.initiated ? formatRelative(u.initiated) : 'at an unknown time'}</p>
              </div>
              {!readonly && (
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void abort([u])}>
                  {busy === u.uploadId && <Spinner />} Abort
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const PAB_FIELDS = [
  ['BlockPublicAcls', 'Block new public ACLs', 'Reject requests that add public ACLs to the bucket or its objects.'],
  ['IgnorePublicAcls', 'Ignore existing public ACLs', 'Treat any existing public ACLs as private.'],
  ['BlockPublicPolicy', 'Block new public bucket policies', 'Reject bucket policies that grant public access.'],
  ['RestrictPublicBuckets', 'Restrict public bucket policies', 'Only the bucket owner and AWS services can use a public policy.'],
] as const;

type Pab = NonNullable<BucketSettings['publicAccessBlock']['value']>;

function PublicAccess({ value, locked, saving, onSave }: { value: Pab | null; locked: boolean; saving: boolean; onSave: (v: Pab) => void }) {
  const initial: Pab = value ?? { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false };
  const [draft, setDraft] = useState(initial);
  // A saved or refreshed value replaces the draft.
  const [draftFor, setDraftFor] = useState(value);
  if (draftFor !== value) {
    setDraftFor(value);
    setDraft(initial);
  }
  const changed = PAB_FIELDS.some(([k]) => draft[k] !== initial[k]);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="divide-y">
        {PAB_FIELDS.map(([k, label, desc]) => (
          <SettingRow key={k} id={`pab-${k}`} title={label} description={desc}>
            <Switch id={`pab-${k}`} checked={draft[k]} disabled={locked} onCheckedChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
          </SettingRow>
        ))}
      </div>
      {!locked && (
        <div className="flex items-center justify-end gap-2 border-t bg-muted/40 px-3 py-2">
          <Button variant="outline" size="sm" disabled={!changed || saving} onClick={() => setDraft(initial)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={!changed || saving}
            onClick={() => {
              const r = publicAccessBlockSchema.safeParse(draft);
              if (r.success) onSave(r.data);
            }}
          >
            {saving && <Spinner />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const NAV: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'versioning', label: 'Versioning', icon: Clock },
  { id: 'cors', label: 'CORS', icon: Globe },
  { id: 'lifecycle', label: 'Lifecycle', icon: Workflow },
  { id: 'policy', label: 'Bucket policy', icon: Shield },
  { id: 'public', label: 'Public access', icon: Lock },
  { id: 'uploads', label: 'Incomplete uploads', icon: Upload },
  { id: 'usage', label: 'Storage usage', icon: ChartColumn },
];

export function BucketSettingsView({ bucket }: { bucket: string }) {
  const { isAdmin, me, connection } = useApp();
  // Bucket settings are admin territory.
  const readonly = !isAdmin || me.readonly;
  const settings = useBucketSettings(bucket);
  const save = useSaveSetting(bucket);
  const [section, setSection] = useState<SectionId>('general');

  const persist = (setting: Parameters<typeof save.mutate>[0]['setting'], body: unknown, label: string) =>
    save.mutate(
      { setting, body },
      {
        onSuccess: () => toast.success(`${label} saved`),
        onError: (e) => toast.error(`Couldn’t save ${label.toLowerCase()}`, { description: errorText(e) }),
      },
    );

  const s = settings.data;
  // Features the provider doesn't implement are hidden, not shown broken.
  const supported: Record<SectionId, boolean> = {
    general: true,
    usage: true,
    uploads: true,
    versioning: s?.versioning.supported ?? connection.capabilities.versioning,
    cors: s?.cors.supported ?? connection.capabilities.cors,
    lifecycle: s?.lifecycle.supported ?? connection.capabilities.lifecycle,
    policy: s?.policy.supported ?? connection.capabilities.bucketPolicy,
    public: s?.publicAccessBlock.supported ?? connection.capabilities.publicAccessBlock,
  };
  const nav = NAV.filter((n) => supported[n.id]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
        <IconButton label="Back to files" onClick={() => navigate({ bucket })}>
          <ArrowLeft />
        </IconButton>
        <Database className="size-4 text-primary" />
        <h1 className="truncate font-semibold">{bucket}</h1>
        <span className="text-sm text-muted-foreground">/ Settings</span>
        {readonly && <Badge variant="secondary">read-only</Badge>}
        <IconButton label="Reload settings" className="ml-auto" onClick={() => void settings.refetch()} disabled={settings.isFetching}>
          <RefreshCw className={settings.isFetching ? 'animate-spin' : undefined} />
        </IconButton>
      </header>

      <Tabs
        orientation="vertical"
        value={section}
        onValueChange={(v) => setSection(v as SectionId)}
        className="flex-col gap-8 px-4 py-6 md:flex-row md:px-6"
      >
        <TabsList className="h-fit w-full shrink-0 flex-col items-stretch gap-0.5 rounded-none bg-transparent p-0 md:sticky md:top-20 md:w-52">
          {nav.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="h-9 flex-none justify-start rounded-md border-0 px-3 font-normal text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:font-medium data-[state=active]:text-primary dark:data-[state=active]:bg-primary/15 dark:data-[state=active]:text-primary"
            >
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0 flex-1">
          {settings.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-80" />
              <Skeleton className="mt-6 h-64 w-full rounded-lg" />
            </div>
          ) : settings.isError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Couldn’t load bucket settings</AlertTitle>
              <AlertDescription>{errorText(settings.error)}</AlertDescription>
            </Alert>
          ) : (
            <>
              <TabsContent value="general">
                <General bucket={bucket} settings={settings.data} onOpen={setSection} />
              </TabsContent>

              <TabsContent value="versioning">
                <SectionHeader title="Versioning" description="Keep every version of every object, so overwritten and deleted files can be restored." />
                {settings.data.versioning.error && <ReadError what="versioning" section="versioning" error={settings.data.versioning.error} />}
                <div className="overflow-hidden rounded-lg border">
                  <SettingRow
                    id="versioning"
                    title="Object versioning"
                    description={
                      settings.data.versioning.value === 'Suspended'
                        ? 'Suspended. Existing versions are kept, new writes overwrite.'
                        : settings.data.versioning.value === 'Enabled'
                          ? 'Enabled. Once on, versioning can be suspended but never fully removed.'
                          : 'Off. Once enabled, versioning can be suspended but never fully removed.'
                    }
                  >
                    <Switch
                      id="versioning"
                      checked={settings.data.versioning.value === 'Enabled'}
                      disabled={readonly || save.isPending || !!settings.data.versioning.error}
                      onCheckedChange={(v) => persist('versioning', { enabled: v }, 'Versioning')}
                    />
                  </SettingRow>
                </div>
              </TabsContent>

              <TabsContent value="cors">
                <SectionHeader
                  title="CORS"
                  description="Lets other web apps call this bucket directly from a browser. s3deck itself doesn’t need any CORS rules."
                />
                {settings.data.cors.error && <ReadError what="CORS rules" section="cors" error={settings.data.cors.error} />}
                <JsonEditor
                  fileName="cors-rules.json"
                  value={settings.data.cors.value}
                  schema={corsSchema}
                  example={EXAMPLES.cors}
                  locked={readonly || !!settings.data.cors.error}
                  emptyLabel="No CORS rules"
                  countLabel={(v) => `${v.length} rule${v.length === 1 ? '' : 's'}`}
                  saving={save.isPending}
                  onSave={(v) => persist('cors', { rules: v ?? [] }, 'CORS rules')}
                />
              </TabsContent>

              <TabsContent value="lifecycle">
                <SectionHeader title="Lifecycle" description="Expire objects or move them to cheaper storage automatically, and clean up abandoned multipart uploads." />
                {settings.data.lifecycle.error && <ReadError what="lifecycle rules" section="lifecycle" error={settings.data.lifecycle.error} />}
                <JsonEditor
                  fileName="lifecycle-rules.json"
                  value={settings.data.lifecycle.value}
                  schema={lifecycleSchema}
                  example={EXAMPLES.lifecycle}
                  locked={readonly || !!settings.data.lifecycle.error}
                  emptyLabel="No lifecycle rules"
                  countLabel={(v) => `${v.length} rule${v.length === 1 ? '' : 's'}`}
                  saving={save.isPending}
                  onSave={(v) => persist('lifecycle', { rules: v ?? [] }, 'Lifecycle rules')}
                />
              </TabsContent>

              <TabsContent value="policy">
                <SectionHeader title="Bucket policy" description="An IAM-style JSON document that grants or denies access to the bucket and its objects." />
                {settings.data.policy.error && <ReadError what="the bucket policy" section="policy" error={settings.data.policy.error} />}
                <JsonEditor
                  fileName="bucket-policy.json"
                  value={settings.data.policy.value}
                  schema={policySchema}
                  example={EXAMPLES.policy(bucket)}
                  locked={readonly || !!settings.data.policy.error}
                  emptyLabel="No policy"
                  saving={save.isPending}
                  onSave={(v) => persist('policy', { policy: v }, 'Bucket policy')}
                />
              </TabsContent>

              <TabsContent value="public">
                <SectionHeader title="Public access" description="Guard rails that override ACLs and policies, so objects can’t be made public by accident." />
                {settings.data.publicAccessBlock.error && (
                  <ReadError what="public access settings" section="public" error={settings.data.publicAccessBlock.error} />
                )}
                <PublicAccess
                  value={settings.data.publicAccessBlock.value}
                  locked={readonly || !!settings.data.publicAccessBlock.error}
                  saving={save.isPending}
                  onSave={(v) => persist('public-access', { config: v }, 'Public access settings')}
                />
              </TabsContent>

              <TabsContent value="uploads">
                <IncompleteUploads bucket={bucket} />
              </TabsContent>

              <TabsContent value="usage">
                <Usage bucket={bucket} />
              </TabsContent>
            </>
          )}
          {readonly && !['general', 'usage', 'uploads'].includes(section) && (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5" /> {me.readonly ? 's3deck is running in read-only mode.' : 'Only admins can change bucket settings.'}
            </p>
          )}
        </div>
      </Tabs>
    </div>
  );
}
