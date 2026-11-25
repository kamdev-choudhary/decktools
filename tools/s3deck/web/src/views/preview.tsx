import { PREVIEW_TEXT_BYTES } from '@shared/constants';
import type { ObjectDetails } from '@shared/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { Archive, Clock, Download, Eye, Info, Share2, Tag as TagIcon, Trash2, Undo2, X } from 'lucide-react';
import { marked } from 'marked';
import Papa from 'papaparse';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { downloadUrl, errorText, readError, triggerDownload } from '@/api/client';
import { invalidateBucket, objectApi, useObjectDetails, useVersions } from '@/api/hooks';
import { useApp } from '@/components/app/app-context';
import { RestoreArchiveDialog } from '@/components/app/browser-extras';
import { CopyButton, ShareDialog, TagsEditor } from '@/components/app/object-dialogs';
import { EmptyState } from '@/components/app/empty-state';
import { IconButton } from '@/components/app/icon-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { languageFor, previewKind, RICH_KINDS, type PreviewKind } from '@/lib/file-types';
import type { RichKind } from './rich-previews';

const RichPreview = lazy(() => import('./rich-previews'));
import { formatBytes, formatDate, NO_PUBLIC_URL_HINT } from '@/lib/format';

/* ------------------------------------------------------------------ */
/* Text-based previews                                                 */
/* ------------------------------------------------------------------ */

async function fetchHead(url: string, signal: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(url, {
    headers: { Range: `bytes=0-${PREVIEW_TEXT_BYTES - 1}` },
    signal,
    credentials: 'same-origin',
  });
  if (!res.ok) throw await readError(res);
  const buf = await res.arrayBuffer();
  const total = Number(res.headers.get('Content-Range')?.split('/')[1] ?? buf.byteLength);
  // Drop a possibly cut multi-byte character at the end.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return { text, truncated: total > buf.byteLength };
}

function CodeView({ text, language }: { text: string; language?: string }) {
  // Highlighted HTML, tagged with the source it was made from so a new file never shows stale markup.
  const [highlighted, setHighlighted] = useState<{ text: string; language: string; html: string | null } | null>(null);
  const html = highlighted && highlighted.text === text && highlighted.language === language ? highlighted.html : null;
  useEffect(() => {
    let cancelled = false;
    if (!language || text.length > 300_000) return;
    void import('highlight.js/lib/common').then(({ default: hljs }) => {
      if (cancelled) return;
      try {
        const lang = hljs.getLanguage(language) ? language : undefined;
        setHighlighted({ text, language, html: lang ? hljs.highlight(text, { language: lang }).value : null });
      } catch {
        setHighlighted({ text, language, html: null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [text, language]);

  return (
    <pre className="min-h-full overflow-auto p-4 font-mono text-xs leading-relaxed">
      {/* highlight.js escapes the source; its output contains only span tags. */}
      {html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{text}</code>}
    </pre>
  );
}

function CsvView({ text, tsv }: { text: string; tsv: boolean }) {
  const rows = useMemo(
    () => Papa.parse<string[]>(text, { delimiter: tsv ? '\t' : '', preview: 500, skipEmptyLines: true }).data,
    [text, tsv],
  );
  const [head, ...body] = rows;
  if (!head) return <EmptyState title="Empty file" />;
  return (
    <div>
      <Table className="text-xs">
        <TableHeader className="sticky top-0 bg-muted">
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={i}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((r, i) => (
            <TableRow key={i}>
              {r.map((c, j) => (
                <TableCell key={j} className="max-w-xs truncate" title={c}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length >= 500 && <p className="p-2 text-xs text-muted-foreground">Showing the first 500 rows.</p>}
    </div>
  );
}

function MarkdownView({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), { USE_PROFILES: { html: true } }),
    [text],
  );
  return <div className="prose-md p-5 text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TextPreview({ url, kind, name }: { url: string; kind: PreviewKind; name: string }) {
  const q = useQuery({
    queryKey: ['preview-text', url],
    queryFn: ({ signal }) => fetchHead(url, signal),
    staleTime: 30_000,
  });
  if (q.isPending)
    return (
      <Center>
        <Spinner />
      </Center>
    );
  if (q.isError) return <EmptyState title="Couldn’t load preview">{errorText(q.error)}</EmptyState>;
  const { text, truncated } = q.data;

  let body: React.ReactNode;
  if (kind === 'json') {
    let pretty: string | null = null;
    if (!truncated) {
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        pretty = null; // JSON Lines or invalid; show as-is
      }
    }
    body = <CodeView text={pretty ?? text} language="json" />;
  } else if (kind === 'csv') {
    body = <CsvView text={text} tsv={name.toLowerCase().endsWith('.tsv')} />;
  } else if (kind === 'markdown') {
    body = <MarkdownView text={text} />;
  } else {
    body = <CodeView text={text} language={kind === 'code' ? languageFor(name) : undefined} />;
  }

  return (
    <div className="flex h-full flex-col">
      {truncated && (
        <Alert className="rounded-none border-x-0 border-t-0 py-2">
          <AlertDescription className="text-xs">
            Large file: showing the first {formatBytes(PREVIEW_TEXT_BYTES)}.
          </AlertDescription>
        </Alert>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-6">{children}</div>;
}

function Preview({
  bucket,
  details,
  versionId,
}: {
  bucket: string;
  details: ObjectDetails;
  versionId?: string | null;
}) {
  const name = details.key.split('/').pop() ?? details.key;
  const kind = previewKind(name, details.contentType);
  const { readonly, connection } = useApp();
  const [restoring, setRestoring] = useState(false);

  // Archived objects can't be read until restored.
  if (details.archive.archived && details.archive.restore !== 'restored') {
    return (
      <>
        <EmptyState
          icon={<Archive />}
          title={details.archive.restore === 'in-progress' ? 'Restore in progress' : 'This object is archived'}
          action={
            details.archive.restore === 'none' && !readonly && connection.capabilities.archiveRestore ? (
              <Button size="sm" onClick={() => setRestoring(true)}>
                <Archive /> Restore from archive…
              </Button>
            ) : undefined
          }
        >
          {details.archive.restore === 'in-progress'
            ? 'A temporary copy is being prepared. Check back later; Deep Archive restores can take up to 48 hours.'
            : `It’s in ${details.storageClass}. Restore it to preview or download.`}
        </EmptyState>
        {restoring && <RestoreArchiveDialog bucket={bucket} keys={[details.key]} onClose={() => setRestoring(false)} />}
      </>
    );
  }
  const url = downloadUrl(bucket, details.key, { inline: true, versionId });

  if (RICH_KINDS.has(kind)) {
    return (
      <Suspense
        fallback={
          <Center>
            <Spinner />
          </Center>
        }
      >
        <RichPreview key={url} kind={kind as RichKind} url={url} name={name} size={details.size} />
      </Suspense>
    );
  }

  switch (kind) {
    case 'image':
      return (
        <Center>
          <img
            src={url}
            alt={name}
            className="max-h-full max-w-full rounded border bg-[conic-gradient(#8881_25%,transparent_0_50%,#8881_0_75%,transparent_0)] bg-[length:16px_16px] object-contain"
          />
        </Center>
      );
    case 'video':
      return (
        <Center>
          <video src={url} controls className="max-h-full max-w-full rounded" preload="metadata" />
        </Center>
      );
    case 'audio':
      return (
        <Center>
          <audio src={url} controls className="w-full" preload="metadata" />
        </Center>
      );
    case 'pdf':
      // No sandbox: browsers refuse to run their built-in PDF viewer in a sandboxed frame.
      // oxlint-disable-next-line react/iframe-missing-sandbox
      return <iframe src={url} title={name} className="h-full w-full border-0" />;
    case 'none':
      return (
        <EmptyState
          icon={<Eye />}
          title="No preview for this file type"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerDownload(downloadUrl(bucket, details.key, { versionId }))}
            >
              <Download /> Download
            </Button>
          }
        />
      );
    default:
      return <TextPreview url={url} kind={kind} name={name} />;
  }
}

/* ------------------------------------------------------------------ */
/* Details & versions                                                  */
/* ------------------------------------------------------------------ */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}

function DetailsTab({ details }: { details: ObjectDetails }) {
  return (
    <div className="space-y-6 p-4">
      <dl>
        <Row label="Key">
          <span className="font-mono text-xs">{details.key}</span>
        </Row>
        <Row label="Size">
          {formatBytes(details.size)}{' '}
          <span className="text-muted-foreground">({details.size.toLocaleString()} bytes)</span>
        </Row>
        <Row label="Last modified">{formatDate(details.lastModified)}</Row>
        <Row label="Content type">{details.contentType ?? '—'}</Row>
        <Row label="Storage class">{details.storageClass ?? '—'}</Row>
        <Row label="ETag">
          <span className="font-mono text-xs">{details.etag ?? '—'}</span>
        </Row>
        {details.versionId && details.versionId !== 'null' && (
          <Row label="Version ID">
            <span className="font-mono text-xs">{details.versionId}</span>
          </Row>
        )}
        {details.archive.archived && (
          <Row label="Archive">
            {details.archive.restore === 'restored'
              ? `Restored copy available until ${formatDate(details.archive.restoreExpiry)}`
              : details.archive.restore === 'in-progress'
                ? 'Restore in progress'
                : 'Archived, not restored'}
          </Row>
        )}
        <Row label="Encryption">
          {details.encryption ? (
            <span>
              {details.encryption.algorithm}
              {details.encryption.kmsKeyId && (
                <span className="block font-mono text-xs text-muted-foreground">{details.encryption.kmsKeyId}</span>
              )}
              {details.encryption.bucketKeyEnabled && (
                <span className="block text-xs text-muted-foreground">S3 Bucket Key enabled</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Not reported</span>
          )}
        </Row>
        {details.lock && (
          <Row label="Object lock">
            <span>
              {details.lock.mode
                ? `${details.lock.mode} until ${formatDate(details.lock.retainUntil)}`
                : 'No retention'}
              {details.lock.legalHold !== null && (
                <span className="block text-xs text-muted-foreground">
                  Legal hold {details.lock.legalHold ? 'on' : 'off'}
                </span>
              )}
            </span>
          </Row>
        )}
        <Row label="Public URL">
          {details.publicUrl ? (
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-xs">{details.publicUrl}</span>
              <CopyButton text={details.publicUrl} />
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{NO_PUBLIC_URL_HINT}</span>
          )}
        </Row>
      </dl>
      <section>
        <h3 className="mb-1 text-sm font-medium">Custom metadata</h3>
        {Object.keys(details.metadata).length ? (
          <dl>
            {Object.entries(details.metadata).map(([k, v]) => (
              <Row key={k} label={`x-amz-meta-${k}`}>
                {v}
              </Row>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">None</p>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-medium">Headers</h3>
        <dl>
          {Object.entries(details.headers).map(([k, v]) => (
            <Row key={k} label={k}>
              <span className="font-mono text-xs">{v}</span>
            </Row>
          ))}
        </dl>
      </section>
    </div>
  );
}

function VersionsTab({
  bucket,
  objectKey,
  onPreview,
}: {
  bucket: string;
  objectKey: string;
  onPreview: (versionId: string) => void;
}) {
  const { readonly } = useApp();
  const qc = useQueryClient();
  const versions = useVersions(bucket, objectKey, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(message);
      await invalidateBucket(qc, bucket);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (versions.isPending)
    return (
      <Center>
        <Spinner />
      </Center>
    );
  if (versions.isError) return <EmptyState title="Couldn’t list versions">{errorText(versions.error)}</EmptyState>;
  const list = versions.data.versions;
  if (list.length <= 1 && list[0]?.versionId === 'null') {
    return (
      <EmptyState icon={<Clock />} title="No versions">
        Turn on versioning in the bucket settings to keep older versions.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y">
      {list.map((v) => (
        <li key={v.versionId} className="flex items-center gap-2 px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5">
              {formatDate(v.lastModified)}
              {v.isLatest && <Badge variant="secondary">current</Badge>}
              {v.isDeleteMarker && <Badge variant="destructive">delete marker</Badge>}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={v.versionId}>
              {v.versionId} {!v.isDeleteMarker && `· ${formatBytes(v.size)}`}
            </p>
          </div>
          {busy === v.versionId && <Spinner />}
          {!v.isDeleteMarker && (
            <>
              <IconButton label="Preview this version" onClick={() => onPreview(v.versionId)}>
                <Eye />
              </IconButton>
              <IconButton
                label="Download this version"
                onClick={() => triggerDownload(downloadUrl(bucket, objectKey, { versionId: v.versionId }))}
              >
                <Download />
              </IconButton>
            </>
          )}
          {!readonly && !v.isLatest && !v.isDeleteMarker && (
            <IconButton
              label="Restore this version"
              disabled={!!busy}
              onClick={() =>
                act(v.versionId, () => objectApi.restoreVersion(bucket, objectKey, v.versionId), 'Version restored')
              }
            >
              <Undo2 />
            </IconButton>
          )}
          {!readonly && (
            <IconButton
              label="Permanently delete this version"
              disabled={!!busy}
              onClick={() => setConfirmDelete(v.versionId)}
            >
              <Trash2 className="text-destructive" />
            </IconButton>
          )}
        </li>
      ))}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this version?</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              Version {confirmDelete} of {objectKey} will be removed for good. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = confirmDelete!;
                void act(id, () => objectApi.deleteVersion(bucket, objectKey, id), 'Version deleted');
              }}
            >
              Delete version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function PreviewPanel({
  bucket,
  objectKey,
  onClose,
}: {
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) {
  const { connection, readonly } = useApp();
  const [versionId, setVersionId] = useState<string | null>(null);
  const [tab, setTab] = useState('preview');
  const [sharing, setSharing] = useState(false);
  const details = useObjectDetails(bucket, objectKey, versionId);
  const name = objectKey.split('/').pop() || objectKey;

  // Opening another object starts on its latest version and the preview tab.
  const [panelFor, setPanelFor] = useState(objectKey);
  if (panelFor !== objectKey) {
    setPanelFor(objectKey);
    setVersionId(null);
    setTab('preview');
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l bg-background" aria-label="Preview">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={objectKey}>
            {name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {details.data ? `${formatBytes(details.data.size)} · ${formatDate(details.data.lastModified)}` : ' '}
            {versionId && (
              <Badge variant="secondary" className="ml-1.5">
                version {versionId.slice(0, 8)}…
              </Badge>
            )}
          </p>
        </div>
        <IconButton label="Download" onClick={() => triggerDownload(downloadUrl(bucket, objectKey, { versionId }))}>
          <Download />
        </IconButton>
        <IconButton label="Share" onClick={() => setSharing(true)}>
          <Share2 />
        </IconButton>
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList variant="line" className="w-full justify-start border-b px-2">
          <TabsTrigger value="preview">
            <Eye /> Preview
          </TabsTrigger>
          <TabsTrigger value="details">
            <Info /> Details
          </TabsTrigger>
          {connection.capabilities.versioning && (
            <TabsTrigger value="versions">
              <Clock /> Versions
            </TabsTrigger>
          )}
          {connection.capabilities.tagging && (
            <TabsTrigger value="tags">
              <TagIcon /> Tags
            </TabsTrigger>
          )}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-auto">
          {details.isPending ? (
            <Center>
              <Spinner />
            </Center>
          ) : details.isError ? (
            <EmptyState title="Couldn’t load this object">{errorText(details.error)}</EmptyState>
          ) : (
            <>
              <TabsContent value="preview" className="h-full">
                <Preview bucket={bucket} details={details.data} versionId={versionId} />
              </TabsContent>
              <TabsContent value="details">
                <DetailsTab details={details.data} />
              </TabsContent>
              <TabsContent value="versions">
                <VersionsTab
                  bucket={bucket}
                  objectKey={objectKey}
                  onPreview={(id) => {
                    setVersionId(id);
                    setTab('preview');
                  }}
                />
              </TabsContent>
              <TabsContent value="tags" className="p-4">
                {readonly ? (
                  <p className="text-sm text-muted-foreground">Read-only mode.</p>
                ) : (
                  <TagsEditor bucket={bucket} keys={[objectKey]} />
                )}
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
      {sharing && (
        <ShareDialog bucket={bucket} objectKey={objectKey} versionId={versionId} onClose={() => setSharing(false)} />
      )}
    </aside>
  );
}
