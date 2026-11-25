import type { Entry, ObjectEntry } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Download,
  Ellipsis,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Archive,
  Layers,
  Share2,
  Tag as TagIcon,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiUrl, downloadUrl, errorText, triggerDownload } from '@/api/client';
import { invalidateBucket, objectApi, useDeleted, useObjects } from '@/api/hooks';
import { onAction, useApp } from '@/components/app/app-context';
import {
  ARCHIVE_CLASSES,
  DeletedRows,
  DRAG_TYPE,
  FolderSizeCell,
  GridView,
  RestoreArchiveDialog,
  StorageClassBadge,
  StorageClassDialog,
} from '@/components/app/browser-extras';
import {
  CopyMoveDialog,
  DeleteDialog,
  MetadataDialog,
  NewFolderDialog,
  RenameDialog,
  ShareDialog,
  TagsDialog,
} from '@/components/app/object-dialogs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/app/empty-state';
import { IconButton } from '@/components/app/icon-button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { iconFor } from '@/lib/file-types';
import { formatBytes, formatDate, formatRelative } from '@/lib/format';
import { hrefFor, navigate, parentPrefix, patchRoute, useRoute } from '@/lib/router';
import { filesFromClipboard, filesFromDrop, filesFromInput, uploadQueue, type FileWithPath } from '@/lib/upload-queue';
import { cn, modKey } from '@/lib/utils';
import { PreviewPanel } from './preview';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

type SortField = 'name' | 'size' | 'lastModified' | 'storageClass';
type DialogState =
  | { type: 'new-folder' }
  | { type: 'delete'; entries: Entry[] }
  | { type: 'rename'; entry: Entry }
  | { type: 'copy'; entries: Entry[] }
  | { type: 'share'; key: string }
  | { type: 'metadata'; keys: string[] }
  | { type: 'tags'; keys: string[] }
  | { type: 'storage-class'; keys: string[] }
  | { type: 'restore-archive'; keys: string[] }
  | null;

type ViewMode = 'list' | 'grid';
const VIEW_KEY = 's3deck-view';
function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function compare(a: Entry, b: Entry, field: SortField): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1; // folders first, always
  if (field === 'name' || a.type === 'folder' || b.type === 'folder') {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
  if (field === 'size') return a.size - b.size;
  if (field === 'lastModified') return (a.lastModified ?? '').localeCompare(b.lastModified ?? '');
  return (a.storageClass ?? '').localeCompare(b.storageClass ?? '');
}

function Breadcrumbs({
  bucket,
  prefix,
  dropProps,
  dropTarget,
}: {
  bucket: string;
  prefix: string;
  dropProps: (prefix: string) => React.HTMLAttributes<HTMLElement>;
  dropTarget: string | null;
}) {
  const parts = prefix.split('/').filter(Boolean);
  const crumbs = [{ label: bucket, prefix: '' }, ...parts.map((p, i) => ({ label: p, prefix: `${parts.slice(0, i + 1).join('/')}/` }))];
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap sm:gap-1.5">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.prefix} className="contents">
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {last ? (
                  <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <a
                      href={hrefFor({ bucket, prefix: c.prefix })}
                      {...dropProps(c.prefix)}
                      className={cn('block max-w-40 truncate rounded px-1', dropTarget === c.prefix && 'bg-primary/15 text-primary')}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) return;
                        e.preventDefault();
                        navigate({ bucket, prefix: c.prefix });
                      }}
                    >
                      {c.label}
                    </a>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function ObjectBrowser({ bucket }: { bucket: string }) {
  const { readonly, connection } = useApp();
  const classes = connection.capabilities.storageClasses;
  const route = useRoute();
  const qc = useQueryClient();
  const searching = route.search.length > 0;
  const listPrefix = searching ? route.search : route.prefix;
  const objects = useObjects(bucket, listPrefix, searching);

  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ field: SortField; dir: 1 | -1 }>({ field: 'name', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(-1);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setViewState] = useState<ViewMode>(readView);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const canShowDeleted = connection.capabilities.versioning && !searching;
  const deleted = useDeleted(bucket, route.prefix, showDeleted && canShowDeleted);
  const deletedEntries = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = deleted.data?.pages.flatMap((p) => p.objects) ?? [];
    return f ? all.filter((d) => d.name.toLowerCase().includes(f)) : all;
  }, [deleted.data, filter]);
  const setView = (v: ViewMode) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer convenience only
    }
  };
  const effectiveView: ViewMode = showDeleted ? 'list' : view;
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const lastClicked = useRef<number>(-1);

  // Reset per-folder state on navigation.
  useEffect(() => {
    setSelected(new Set());
    setFilter('');
    setFocus(-1);
  }, [listPrefix, bucket]);

  const rows: Entry[] = useMemo(() => {
    const pages = objects.data?.pages ?? [];
    const all: Entry[] = [...pages.flatMap((p) => p.folders), ...pages.flatMap((p) => p.objects)];
    const f = filter.trim().toLowerCase();
    const filtered = f ? all.filter((e) => (searching ? e.key : e.name).toLowerCase().includes(f)) : all;
    return filtered.sort((a, b) => compare(a, b, sort.field) * (a.type === b.type ? sort.dir : 1));
  }, [objects.data, filter, sort, searching]);

  const selectedEntries = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected]);
  const selectedObjects = selectedEntries.filter((e): e is ObjectEntry => e.type === 'object');

  // Infinite scroll: load the next page as the end comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting && objects.hasNextPage && !objects.isFetchingNextPage) void objects.fetchNextPage();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [objects]);

  const refresh = useCallback(() => void invalidateBucket(qc, bucket), [qc, bucket]);

  const upload = useCallback(
    (files: FileWithPath[]) => {
      if (readonly) return toast.error('s3deck is in read-only mode');
      if (!files.length) return;
      const rejected = uploadQueue.add(connection.id, bucket, route.prefix, files);
      if (rejected.length) toast.error(`${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped: key too long or invalid`);
    },
    [bucket, route.prefix, readonly, connection.id],
  );

  // Paste files (e.g. screenshots) to upload them here.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      const files = filesFromClipboard(e.clipboardData);
      if (!files.length || readonly || searching) return;
      e.preventDefault();
      upload(files);
      toast.success(`Uploading ${files.length} pasted file${files.length === 1 ? '' : 's'}`);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [upload, readonly, searching]);

  // Drag objects onto a folder, breadcrumb or the up button to move them.
  const moveTo = async (destPrefix: string, keys: string[]) => {
    const entries = rows.filter((r) => keys.includes(r.key));
    const items = entries
      .filter((e) => !(e.type === 'folder' && destPrefix.startsWith(e.key)))
      .map((e) => ({ source: e.key, destination: `${destPrefix}${e.name}${e.type === 'folder' ? '/' : ''}` }))
      .filter((i) => i.source !== i.destination);
    if (!items.length) return;
    const where = destPrefix || bucket;
    const id = toast.loading(`Moving ${items.length} item${items.length === 1 ? '' : 's'} to ${where}…`);
    try {
      const r = await objectApi.copy(bucket, { destinationBucket: bucket, move: true, items });
      toast.success(`Moved ${r.copied} object${r.copied === 1 ? '' : 's'} to ${where}`, { id });
      setSelected(new Set());
    } catch (e) {
      toast.error(errorText(e), { id });
    } finally {
      refresh();
    }
  };
  const canDrag = !readonly && !searching;
  const dragProps = (entry: Entry) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            const keys = selected.has(entry.key) ? [...selected] : [entry.key];
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys));
            e.dataTransfer.effectAllowed = 'move';
          },
          onDragEnd: () => setDropTarget(null),
        }
      : {};
  const dropProps = (prefix: string) =>
    canDrag
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setDropTarget(prefix);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((t) => (t === prefix ? null : t));
          },
          onDrop: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            try {
              void moveTo(prefix, JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[]);
            } catch {
              // not ours
            }
          },
        }
      : {};

  const open = (entry: Entry) => {
    if (entry.type === 'folder') navigate({ bucket, prefix: entry.key });
    else patchRoute({ object: entry.key }, { replace: !!route.object });
  };

  const download = async (entries: Entry[]) => {
    if (entries.length === 1 && entries[0]!.type === 'object') {
      triggerDownload(downloadUrl(bucket, entries[0]!.key));
      return;
    }
    try {
      const { token } = await objectApi.zip(bucket, {
        base: searching ? '' : route.prefix,
        keys: entries.filter((e) => e.type === 'object').map((e) => e.key),
        prefixes: entries.filter((e) => e.type === 'folder').map((e) => e.key),
      });
      triggerDownload(apiUrl(`zip/${token}`));
      toast.info('Preparing ZIP download…', { description: 'The file is built on the fly and streams as it’s created.' });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const toggle = (index: number, e?: { shiftKey?: boolean }) => {
    const entry = rows[index];
    if (!entry) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (e?.shiftKey && lastClicked.current >= 0) {
        const [a, b] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)];
        for (let i = a; i <= b; i++) next.add(rows[i]!.key);
      } else if (next.has(entry.key)) next.delete(entry.key);
      else next.add(entry.key);
      return next;
    });
    lastClicked.current = index;
  };

  // Actions from the command menu.
  useEffect(
    () =>
      onAction((a) => {
        if (a === 'upload') fileInput.current?.click();
        if (a === 'upload-folder') folderInput.current?.click();
        if (a === 'new-folder' && !readonly) setDialog({ type: 'new-folder' });
        if (a === 'refresh') refresh();
      }),
    [readonly, refresh],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        if (!readonly) fileInput.current?.click();
        return;
      }
      if (typing) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(rows.map((r) => r.key)));
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocus((f) => Math.max(0, Math.min(rows.length - 1, f + (e.key === 'ArrowDown' ? 1 : -1))));
      } else if (e.key === 'Enter' && rows[focus]) {
        e.preventDefault();
        open(rows[focus]);
      } else if (e.key === ' ' && rows[focus]) {
        e.preventDefault();
        const entry = rows[focus];
        if (entry.type === 'object') patchRoute({ object: route.object === entry.key ? null : entry.key }, { replace: true });
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (searching) patchRoute({ search: '' });
        else if (route.prefix) navigate({ bucket, prefix: parentPrefix(route.prefix) });
      } else if (e.key === 'Escape') {
        if (route.object) patchRoute({ object: null }, { replace: true });
        else setSelected(new Set());
      } else if (e.key === '/') {
        e.preventDefault();
        filterInput.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the focused row visible.
  useEffect(() => {
    tableRef.current?.querySelector(`[data-index="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const sortHeader = (field: SortField, label: string, className?: string) => (
    <Button
      variant="ghost"
      size="xs"
      className={cn('-ml-2 text-muted-foreground', className)}
      onClick={() => setSort((s) => ({ field, dir: s.field === field ? (s.dir === 1 ? -1 : 1) : 1 }))}
    >
      {label}
      {sort.field === field ? (
        <ArrowUp className={cn('transition-transform', sort.dir === -1 && 'rotate-180')} />
      ) : (
        <ArrowUpDown className="opacity-40" />
      )}
    </Button>
  );

  const rowMenu = (entry: Entry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover/row:opacity-100 data-[state=open]:opacity-100" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {entry.type === 'object' ? (
          <>
            <DropdownMenuItem onSelect={() => open(entry)}>
              <Eye /> Preview <DropdownMenuShortcut>Space</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download([entry])}>
              <Download /> Download
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ type: 'share', key: entry.key })}>
              <Share2 /> Share link…
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => open(entry)}>
              <Folder /> Open <DropdownMenuShortcut>↵</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download([entry])}>
              <Download /> Download as ZIP
            </DropdownMenuItem>
          </>
        )}
        {!readonly && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog({ type: 'rename', entry })}>
              <Pencil /> Rename…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ type: 'copy', entries: [entry] })}>
              <ArrowRightLeft /> Copy or move…
            </DropdownMenuItem>
            {entry.type === 'object' && (
              <>
                <DropdownMenuItem onSelect={() => setDialog({ type: 'metadata', keys: [entry.key] })}>
                  <FileText /> Edit metadata…
                </DropdownMenuItem>
                {classes.length > 1 && (
                  <DropdownMenuItem onSelect={() => setDialog({ type: 'storage-class', keys: [entry.key] })}>
                    <Layers /> Change storage class…
                  </DropdownMenuItem>
                )}
                {connection.capabilities.archiveRestore && ARCHIVE_CLASSES.has(entry.storageClass ?? '') && (
                  <DropdownMenuItem onSelect={() => setDialog({ type: 'restore-archive', keys: [entry.key] })}>
                    <Archive /> Restore from archive…
                  </DropdownMenuItem>
                )}
                {connection.capabilities.tagging && (
                  <DropdownMenuItem onSelect={() => setDialog({ type: 'tags', keys: [entry.key] })}>
                    <TagIcon /> Edit tags…
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ type: 'delete', entries: [entry] })}>
              <Trash2 /> Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (readonly || !e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={async (e) => {
          if (readonly || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(false);
          try {
            upload(await filesFromDrop(e.dataTransfer));
          } catch (err) {
            toast.error(`Couldn’t read dropped files: ${errorText(err)}`);
          }
        }}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <IconButton
            label={searching ? 'Back to folder' : 'Up one folder (⌫)'}
            disabled={!searching && !route.prefix}
            onClick={() => (searching ? patchRoute({ search: '' }) : navigate({ bucket, prefix: parentPrefix(route.prefix) }))}
            {...(route.prefix && !searching ? dropProps(parentPrefix(route.prefix)) : {})}
            className={cn(route.prefix && dropTarget === parentPrefix(route.prefix) && 'bg-primary/15 text-primary')}
          >
            <ArrowUp />
          </IconButton>
          <div className="min-w-0 flex-1">
            {searching ? (
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  Keys starting with <span className="rounded bg-muted px-1 font-mono">{route.search}</span> in {bucket}
                </span>
                <Button variant="ghost" size="sm" onClick={() => patchRoute({ search: '' })}>
                  <X /> Clear
                </Button>
              </div>
            ) : (
              <Breadcrumbs bucket={bucket} prefix={route.prefix} dropProps={dropProps} dropTarget={dropTarget} />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <InputGroup className="h-8 w-40 lg:w-56">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                ref={filterInput}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filter.trim()) {
                    patchRoute({ search: (searching ? '' : route.prefix) + filter.trim(), object: null });
                    setFilter('');
                  }
                }}
                placeholder="Filter · Enter searches bucket"
                className="text-xs"
                aria-label="Filter this folder; press Enter to search the whole bucket by prefix"
              />
              {filter && (
                <InputGroupAddon align="inline-end">
                  <Kbd>↵</Kbd>
                </InputGroupAddon>
              )}
            </InputGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="View options">
                  <SlidersHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>View</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={effectiveView} onValueChange={(v) => setView(v as ViewMode)}>
                  <DropdownMenuRadioItem value="list" disabled={showDeleted}>
                    List
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grid" disabled={showDeleted}>
                    Grid with thumbnails
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {canShowDeleted && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={showDeleted} onCheckedChange={(v) => setShowDeleted(v === true)}>
                      Show deleted files
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton label="Refresh" onClick={refresh} disabled={objects.isFetching}>
              <RefreshCw className={cn(objects.isFetching && !objects.isFetchingNextPage && 'animate-spin')} />
            </IconButton>
            <IconButton label="Bucket settings" onClick={() => navigate({ bucket, view: 'settings' })}>
              <Settings />
            </IconButton>
            {!readonly && !searching && (
              <>
                <IconButton label="New folder" variant="outline" onClick={() => setDialog({ type: 'new-folder' })}>
                  <FolderPlus />
                </IconButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">
                      <Upload /> Upload <ChevronDown className="-mr-1 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                      <Upload /> Files <DropdownMenuShortcut>{modKey}U</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => folderInput.current?.click()}>
                      <FolderUp /> Folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {/* Table: the outer div scrolls, so the shadcn Table's own container must not. */}
        <div ref={tableRef} className="min-h-0 flex-1 overflow-auto [&>[data-slot=table-container]]:overflow-visible">
          {effectiveView === 'grid' && !objects.isPending ? (
            <GridView
              bucket={bucket}
              rows={rows}
              selected={selected}
              openKey={route.object}
              focus={focus}
              onOpen={(entry, index, e) => {
                setFocus(index);
                if (e.metaKey || e.ctrlKey || e.shiftKey) toggle(index, e);
                else open(entry);
              }}
              onToggle={toggle}
              menu={rowMenu}
              dragProps={dragProps}
              dropProps={dropProps}
              dropTarget={dropTarget}
            />
          ) : (
          <Table className="table-fixed border-separate border-spacing-0 [&_td]:border-b [&_th]:border-b [&_tr]:border-0">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.key)) : new Set())}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>{sortHeader('name', 'Name')}</TableHead>
                <TableHead className="w-24 text-right">{sortHeader('size', 'Size', 'ml-0 -mr-2')}</TableHead>
                <TableHead className="w-40">{sortHeader('lastModified', 'Last modified')}</TableHead>
                <TableHead className="hidden w-32 md:table-cell">{sortHeader('storageClass', 'Storage class')}</TableHead>
                <TableHead className="w-12 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4">
                      <Skeleton className="size-4" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              {rows.map((entry, index) => {
                const Icon = entry.type === 'folder' ? Folder : iconFor(entry.name);
                const isSelected = selected.has(entry.key);
                const isOpen = route.object === entry.key;
                return (
                  <TableRow
                    key={entry.key}
                    data-index={index}
                    data-state={isSelected || isOpen ? 'selected' : undefined}
                    {...dragProps(entry)}
                    {...(entry.type === 'folder' ? dropProps(entry.key) : {})}
                    onClick={(e) => {
                      setFocus(index);
                      if (e.metaKey || e.ctrlKey || e.shiftKey) toggle(index, e);
                      else open(entry);
                    }}
                    className={cn(
                      'group/row cursor-default data-[state=selected]:bg-primary/8 dark:data-[state=selected]:bg-primary/15',
                      focus === index && 'outline-2 -outline-offset-2 outline-ring/60',
                      dropTarget === entry.key && 'bg-primary/15 outline-2 -outline-offset-2 outline-primary',
                    )}
                  >
                    <TableCell className="pl-4">
                      <Checkbox checked={isSelected} onClick={(e) => (e.stopPropagation(), toggle(index, e))} aria-label={`Select ${entry.name}`} />
                    </TableCell>
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className={cn('size-4 shrink-0', entry.type === 'folder' ? 'fill-primary/15 text-primary' : 'text-muted-foreground')} />
                        <span className="truncate" title={entry.key}>
                          {searching ? entry.key : entry.name}
                          {entry.type === 'folder' && <span className="text-muted-foreground">/</span>}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {entry.type === 'object' ? formatBytes(entry.size) : <FolderSizeCell bucket={bucket} prefix={entry.key} />}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground" title={entry.type === 'object' ? formatDate(entry.lastModified) : undefined}>
                      {entry.type === 'object' ? formatRelative(entry.lastModified) : ''}
                    </TableCell>
                    <TableCell className="hidden truncate text-xs text-muted-foreground md:table-cell">
                      {entry.type === 'object' ? <StorageClassBadge value={entry.storageClass} /> : ''}
                    </TableCell>
                    <TableCell className="pr-4 text-right">{rowMenu(entry)}</TableCell>
                  </TableRow>
                );
              })}
              {showDeleted && <DeletedRows bucket={bucket} entries={deletedEntries} readonly={readonly} />}
            </TableBody>
          </Table>
          )}
          {showDeleted && deleted.hasNextPage && (
            <div className="flex justify-center py-2">
              <Button variant="ghost" size="sm" onClick={() => void deleted.fetchNextPage()} disabled={deleted.isFetchingNextPage}>
                {deleted.isFetchingNextPage && <Spinner />} More deleted files
              </Button>
            </div>
          )}

          {objects.isError ? (
            <EmptyState title="Couldn’t list this folder">{errorText(objects.error)}</EmptyState>
          ) : !objects.isPending && rows.length === 0 && !(showDeleted && deletedEntries.length) ? (
            filter ? (
              <EmptyState icon={<Search />} title={`Nothing matches “${filter}”`}>
                Press <Kbd>Enter</Kbd> to search the whole bucket for keys starting with it.
              </EmptyState>
            ) : (
              <EmptyState
                icon={<Folder />}
                title={searching ? 'No keys with this prefix' : 'This folder is empty'}
                action={
                  !readonly && !searching ? (
                    <Button size="sm" onClick={() => fileInput.current?.click()}>
                      <Upload /> Upload files
                    </Button>
                  ) : undefined
                }
              >
                {!readonly && !searching && 'Drop files or folders here, or upload from your computer.'}
              </EmptyState>
            )
          ) : (
            !objects.isPending && (
              <div ref={sentinel} className="flex justify-center py-3 text-xs text-muted-foreground">
                {objects.isFetchingNextPage ? (
                  <Spinner />
                ) : objects.hasNextPage ? (
                  <Button variant="ghost" size="sm" onClick={() => void objects.fetchNextPage()}>
                    Load more
                  </Button>
                ) : (
                  <span>
                    {rows.length.toLocaleString()} item{rows.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            )
          )}
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div
            role="toolbar"
            aria-label="Selection actions"
            className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 animate-in items-center gap-1 overflow-x-auto rounded-lg border bg-popover p-1.5 text-sm fade-in slide-in-from-bottom-2"
          >
            <span className="px-2 font-medium whitespace-nowrap">{selected.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => void download(selectedEntries)}>
              <Download /> {selectedEntries.length === 1 && selectedEntries[0]!.type === 'object' ? 'Download' : 'Download ZIP'}
            </Button>
            {!readonly && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'copy', entries: selectedEntries })}>
                  <ArrowRightLeft /> Copy / move
                </Button>
                {selectedObjects.length > 0 && selectedObjects.length === selectedEntries.length && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'metadata', keys: selectedObjects.map((o) => o.key) })}>
                      <FileText /> Metadata
                    </Button>
                    {connection.capabilities.tagging && (
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'tags', keys: selectedObjects.map((o) => o.key) })}>
                        <TagIcon /> Tags
                      </Button>
                    )}
                    {classes.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'storage-class', keys: selectedObjects.map((o) => o.key) })}>
                        <Layers /> Class
                      </Button>
                    )}
                    {connection.capabilities.archiveRestore && selectedObjects.some((o) => ARCHIVE_CLASSES.has(o.storageClass ?? '')) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDialog({
                            type: 'restore-archive',
                            keys: selectedObjects.filter((o) => ARCHIVE_CLASSES.has(o.storageClass ?? '')).map((o) => o.key),
                          })
                        }
                      >
                        <Archive /> Restore
                      </Button>
                    )}
                  </>
                )}
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDialog({ type: 'delete', entries: selectedEntries })}>
                  <Trash2 /> Delete
                </Button>
              </>
            )}
            <IconButton label="Clear selection (Esc)" onClick={() => setSelected(new Set())}>
              <X />
            </IconButton>
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="size-8" />
              <p className="font-medium">Drop to upload to {bucket}/{route.prefix}</p>
            </div>
          </div>
        )}
      </div>

      <Sheet open={!!route.object} onOpenChange={(open) => !open && patchRoute({ object: null }, { replace: true })}>
        <SheetContent
          aria-describedby={undefined}
          className="w-full gap-0 border-l-0 sm:max-w-none md:w-[min(44rem,60vw)]"
          // Keep focus where it is instead of jumping to the first header button.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetTitle className="sr-only">Preview {route.object?.split('/').pop()}</SheetTitle>
          {route.object && (
            <PreviewPanel bucket={bucket} objectKey={route.object} onClose={() => patchRoute({ object: null }, { replace: true })} />
          )}
        </SheetContent>
      </Sheet>

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (upload(filesFromInput(e.target.files)), (e.target.value = ''))} />
      <input
        ref={folderInput}
        type="file"
        hidden
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        onChange={(e) => (upload(filesFromInput(e.target.files)), (e.target.value = ''))}
      />

      {dialog?.type === 'new-folder' && (
        <NewFolderDialog bucket={bucket} prefix={route.prefix} onClose={() => setDialog(null)} onCreated={(p) => navigate({ bucket, prefix: p })} />
      )}
      {dialog?.type === 'delete' && (
        <DeleteDialog
          bucket={bucket}
          entries={dialog.entries}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setSelected(new Set());
            if (route.object && dialog.entries.some((e) => e.key === route.object)) patchRoute({ object: null }, { replace: true });
          }}
        />
      )}
      {dialog?.type === 'rename' && <RenameDialog bucket={bucket} entry={dialog.entry} onClose={() => setDialog(null)} />}
      {dialog?.type === 'copy' && <CopyMoveDialog bucket={bucket} prefix={route.prefix} entries={dialog.entries} onClose={() => setDialog(null)} />}
      {dialog?.type === 'share' && <ShareDialog bucket={bucket} objectKey={dialog.key} onClose={() => setDialog(null)} />}
      {dialog?.type === 'metadata' && <MetadataDialog bucket={bucket} keys={dialog.keys} onClose={() => setDialog(null)} />}
      {dialog?.type === 'tags' && <TagsDialog bucket={bucket} keys={dialog.keys} onClose={() => setDialog(null)} />}
      {dialog?.type === 'storage-class' && (
        <StorageClassDialog bucket={bucket} keys={dialog.keys} classes={classes} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'restore-archive' && <RestoreArchiveDialog bucket={bucket} keys={dialog.keys} onClose={() => setDialog(null)} />}
    </div>
  );
}
