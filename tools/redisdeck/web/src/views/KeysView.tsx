import {
  ArrowLeft,
  Clock,
  Copy,
  KeyRound,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Timer,
  Trash2,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { KeyDetail, NewKey } from "@shared/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deck/ui/components/alert-dialog";
import { Button } from "@deck/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@deck/ui/components/dropdown-menu";
import { Input } from "@deck/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deck/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@deck/ui/components/tooltip";
import { cn } from "@deck/ui/lib/utils";
import {
  useCreateKey,
  useDbSize,
  useKeyAction,
  useKeyDetail,
  useKeyList,
  useServer,
} from "@/api/hooks";
import { CenteredSpinner, ErrorAlert, Spinner } from "@/components/feedback";
import { FormDialog, type Field } from "@/components/FormDialog";
import { TypeBadge } from "@/components/TypeBadge";
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatTtl,
} from "@/lib/format";
import { keyHref, keysHref, navigate } from "@/lib/router";
import { CREATABLE, typeLabel } from "@/lib/types";
import {
  HashEditor,
  JsonEditor,
  ListEditor,
  SetEditor,
  StreamEditor,
  StringEditor,
  ZSetEditor,
} from "./ValueEditors";

/** user:2 before user:10. */
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Plain text searches anywhere in the name; text with * ? [ is used as a SCAN pattern as-is. */
const toPattern = (q: string) =>
  !q.trim() ? "*" : /[*?[]/.test(q) ? q.trim() : `*${q.trim()}*`;

const TYPE_FILTERS = [
  { value: "all", label: "All types" },
  ...CREATABLE.map((t) => ({ value: t.type, label: t.label })),
];

/* ------------------------------------------------------------------ */
/* Key list                                                            */
/* ------------------------------------------------------------------ */

function KeyList({
  db,
  selected,
  readonly,
  onNew,
}: {
  db: number;
  selected: string | null;
  readonly: boolean;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const pattern = useDeferredValue(toPattern(query));
  const [type, setType] = useState("all");
  const list = useKeyList(db, pattern, type === "all" ? "" : type);
  const size = useDbSize(db);
  const sentinel = useRef<HTMLDivElement>(null);

  const keys = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages ?? [])
      .flatMap((p) => p.keys)
      .filter((k) => !seen.has(k.id) && !!seen.add(k.id))
      .sort((a, b) => naturalOrder.compare(a.name.text, b.name.text));
  }, [list.data]);

  // Endless scroll: fetch the next SCAN page when the end of the list comes into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage)
        void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]); // re-armed after each page, so a still-visible end loads the next

  const scanning = list.isFetching && !list.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keys, or a pattern like user:*"
              aria-label="Search keys"
              spellCheck={false}
              className="h-8 pl-8 font-mono text-[12.5px]"
            />
          </div>
          {!readonly && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" onClick={onNew} aria-label="New key">
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New key</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger
              size="sm"
              className="h-7 w-36 text-xs"
              aria-label="Filter by type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {formatNumber(keys.length)}
            {list.hasNextPage ? "+" : ""} found
            {size.data && ` · ${formatNumber(size.data.keys)} in db${db}`}
          </span>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void list.refetch()}
                aria-label="Rescan"
              >
                <RefreshCw className={cn(scanning && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rescan</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="list"
        aria-label="Keys"
      >
        {list.isPending && <CenteredSpinner label="Scanning…" />}
        {list.isError && (
          <ErrorAlert error={list.error} className="m-3 w-auto" />
        )}
        {list.isSuccess && keys.length === 0 && !list.hasNextPage && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <KeyRound className="size-5" />
            {pattern === "*" && type === "all"
              ? `db${db} is empty.`
              : "No keys match."}
          </div>
        )}
        {keys.map((k) => (
          <a
            key={k.id}
            role="listitem"
            href={keyHref(db, k.id)}
            aria-current={k.id === selected ? "true" : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 border-b border-transparent px-3 text-[13px] hover:bg-row-hover",
              k.id === selected && "bg-row-selected hover:bg-row-selected",
            )}
          >
            <TypeBadge type={k.type} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-[12.5px]",
                k.name.binary && "italic",
              )}
              title={k.name.text}
            >
              {k.name.text}
            </span>
            {k.ttl >= 0 && (
              <span
                className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
                title={formatTtl(k.ttl)}
              >
                <Clock className="size-3" />
                {formatDuration(k.ttl / 1000)}
              </span>
            )}
          </a>
        ))}
        <div ref={sentinel} className="flex justify-center py-3">
          {list.isFetchingNextPage && <Spinner />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key panel                                                           */
/* ------------------------------------------------------------------ */

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{children}</span>
    </div>
  );
}

function KeyEditor({
  db,
  detail,
  readonly,
}: {
  db: number;
  detail: KeyDetail;
  readonly: boolean;
}) {
  const props = { db, detail, readonly };
  switch (detail.value.type) {
    case "string":
      return <StringEditor {...props} />;
    case "hash":
      return <HashEditor {...props} />;
    case "list":
      return <ListEditor {...props} />;
    case "set":
      return <SetEditor {...props} />;
    case "zset":
      return <ZSetEditor {...props} />;
    case "stream":
      return <StreamEditor {...props} />;
    case "ReJSON-RL":
      return <JsonEditor {...props} />;
    default:
      return (
        <p className="p-6 text-sm text-muted-foreground">
          {detail.value.message}
        </p>
      );
  }
}

type KeyDialog = "rename" | "ttl" | "delete" | null;

function KeyPanel({
  db,
  id,
  readonly,
}: {
  db: number;
  id: string;
  readonly: boolean;
}) {
  const detail = useKeyDetail(db, id);
  const action = useKeyAction(db);
  const [dialog, setDialog] = useState<KeyDialog>(null);

  if (detail.isPending) return <CenteredSpinner />;
  if (detail.isError)
    return (
      <div className="p-6">
        <ErrorAlert error={detail.error} />
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => navigate(keysHref(db))}
        >
          <ArrowLeft /> Back to keys
        </Button>
      </div>
    );

  const d = detail.data;
  const binaryName = !!d.name.binary;
  const close = () => {
    setDialog(null);
    action.reset();
  };
  const done = (message: string) => {
    toast.success(message);
    close();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 md:hidden"
            onClick={() => navigate(keysHref(db))}
            aria-label="Back to keys"
          >
            <ArrowLeft />
          </Button>
          <TypeBadge type={d.type} full className="mt-0.5" />
          <h1
            className={cn(
              "min-w-0 flex-1 font-mono text-sm font-medium break-all",
              binaryName && "italic",
            )}
          >
            {d.name.text}
          </h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void detail.refetch()}
                aria-label="Reload"
              >
                <RefreshCw
                  className={cn(detail.isFetching && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Key actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(d.name.text);
                  toast.success("Key name copied");
                }}
              >
                <Copy /> Copy name
              </DropdownMenuItem>
              {!readonly && (
                <>
                  <DropdownMenuItem onSelect={() => setDialog("ttl")}>
                    <Timer /> Set expiry…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={binaryName}
                    onSelect={() => setDialog("rename")}
                  >
                    <PencilLine /> Rename…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDialog("delete")}
                  >
                    <Trash2 /> Delete key
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <Meta
            label={
              d.type === "string" || d.type === "ReJSON-RL" ? "Size" : "Length"
            }
          >
            {d.type === "string" || d.type === "ReJSON-RL"
              ? formatBytes(d.length)
              : formatNumber(d.length)}
          </Meta>
          <Meta label="TTL">
            {readonly ? (
              formatTtl(d.ttl)
            ) : (
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2 hover:text-link"
                onClick={() => setDialog("ttl")}
              >
                {formatTtl(d.ttl)}
              </button>
            )}
          </Meta>
          {d.memory !== null && (
            <Meta label="Memory">{formatBytes(d.memory)}</Meta>
          )}
          {d.encoding && <Meta label="Encoding">{d.encoding}</Meta>}
        </div>
      </div>

      <KeyEditor db={db} detail={d} readonly={readonly} />

      <FormDialog
        open={dialog === "rename"}
        onOpenChange={(o) => !o && close()}
        title="Rename key"
        description="Fails rather than overwrite if a key with the new name exists."
        fields={[
          {
            name: "name",
            label: "New name",
            initial: d.name.text,
            required: true,
          },
        ]}
        submitLabel="Rename"
        pending={action.isPending}
        error={action.error}
        onSubmit={(v) =>
          action.mutate(
            { op: "rename", id: d.id, newName: v.name! },
            {
              onSuccess: (res) => {
                done(res.message);
                // The id is the name's bytes, so the renamed key has a new one.
                navigate(
                  keyHref(
                    db,
                    btoa(
                      String.fromCharCode(...new TextEncoder().encode(v.name!)),
                    ),
                  ),
                  true,
                );
              },
            },
          )
        }
      />
      <FormDialog
        open={dialog === "ttl"}
        onOpenChange={(o) => !o && close()}
        title="Set expiry"
        description={`Currently: ${formatTtl(d.ttl).toLowerCase()}. Leave empty to keep the key forever.`}
        fields={[
          {
            name: "seconds",
            label: "Expire after (seconds)",
            initial: d.ttl > 0 ? String(Math.ceil(d.ttl / 1000)) : "",
            type: "number",
            placeholder: "e.g. 3600 for one hour",
          },
        ]}
        submitLabel="Save"
        pending={action.isPending}
        error={action.error}
        onSubmit={(v) => {
          const s = v.seconds!.trim() === "" ? null : Number(v.seconds);
          action.mutate(
            { op: "expire", id: d.id, seconds: s },
            { onSuccess: (res) => done(res.message) },
          );
        }}
      />
      <AlertDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this key?</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              <span className="font-mono text-foreground">{d.name.text}</span> (
              {typeLabel(d.type).toLowerCase()}, {formatNumber(d.length)}{" "}
              {d.type === "string" ? "bytes" : "elements"}) will be deleted.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {action.isError && <ErrorAlert error={action.error} />}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                action.mutate(
                  { op: "delete", ids: [d.id] },
                  {
                    onSuccess: (res) => {
                      done(res.message);
                      navigate(keysHref(db), true);
                    },
                  },
                );
              }}
              disabled={action.isPending}
            >
              {action.isPending && <Spinner className="text-current" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New key                                                             */
/* ------------------------------------------------------------------ */

type Values = Record<string, string>;
type Base = { name: string; ttl?: number };

/**
 * Per type: the inputs for its first element, and how they become the
 * create request. Adding a type is one entry here.
 */
const NEW_KEY: Record<
  NewKey["type"],
  { fields: Field[]; build: (base: Base, v: Values) => NewKey }
> = {
  string: {
    fields: [{ name: "value", label: "Value", multiline: true }],
    build: (base, v) => ({ type: "string", ...base, value: v.value! }),
  },
  hash: {
    fields: [
      { name: "field", label: "First field", required: true },
      { name: "value", label: "Value", multiline: true },
    ],
    build: (base, v) => ({
      type: "hash",
      ...base,
      field: v.field!,
      value: v.value!,
    }),
  },
  list: {
    fields: [{ name: "value", label: "First element", multiline: true }],
    build: (base, v) => ({ type: "list", ...base, value: v.value! }),
  },
  set: {
    fields: [{ name: "member", label: "First member", multiline: true }],
    build: (base, v) => ({ type: "set", ...base, member: v.member! }),
  },
  zset: {
    fields: [
      {
        name: "score",
        label: "Score",
        type: "number",
        initial: "0",
        required: true,
      },
      { name: "member", label: "First member", multiline: true },
    ],
    build: (base, v) => ({
      type: "zset",
      ...base,
      member: v.member!,
      score: Number(v.score),
    }),
  },
  stream: {
    fields: [
      { name: "field", label: "First field", required: true },
      { name: "value", label: "Value", multiline: true },
    ],
    build: (base, v) => ({
      type: "stream",
      ...base,
      field: v.field!,
      value: v.value!,
    }),
  },
  "ReJSON-RL": {
    fields: [
      {
        name: "json",
        label: "JSON",
        multiline: true,
        initial: "{}",
        hint: "Needs the RedisJSON module (built into Redis 8 and Redis Stack).",
      },
    ],
    build: (base, v) => ({ type: "ReJSON-RL", ...base, json: v.json! }),
  },
};

function NewKeyDialog({
  db,
  open,
  onOpenChange,
}: {
  db: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateKey(db);
  const [type, setType] = useState<NewKey["type"]>("string");
  const fields: Field[] = [
    {
      name: "name",
      label: "Key name",
      required: true,
      placeholder: "e.g. user:42:profile",
    },
    ...NEW_KEY[type].fields,
    {
      name: "ttl",
      label: "Expire after (seconds)",
      type: "number",
      placeholder: "Optional",
    },
  ];

  return (
    <FormDialog
      key={type}
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        create.reset();
      }}
      title="New key"
      fields={fields}
      submitLabel={`Create ${typeLabel(type).toLowerCase()}`}
      pending={create.isPending}
      error={create.error}
      onSubmit={(v) => {
        const spec = NEW_KEY[type].build(
          { name: v.name!, ttl: v.ttl ? Number(v.ttl) : undefined },
          v,
        );
        create.mutate(spec, {
          onSuccess: (k) => {
            toast.success(`Created ${v.name}`);
            onOpenChange(false);
            navigate(keyHref(db, k.id));
          },
        });
      }}
    >
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Key type"
      >
        {CREATABLE.map((t) => (
          <button
            key={t.type}
            type="button"
            role="radio"
            aria-checked={type === t.type}
            onClick={() => setType(t.type)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
              type === t.type
                ? "border-foreground bg-accent font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function KeysView({
  db,
  selected,
}: {
  db: number;
  selected: string | null;
}) {
  const readonly = useServer().data?.readonly ?? true;
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "w-full shrink-0 border-r md:block md:w-[380px] lg:w-[420px]",
          selected && "hidden",
        )}
      >
        <KeyList
          db={db}
          selected={selected}
          readonly={readonly}
          onNew={() => setCreating(true)}
        />
      </aside>
      <section className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
        {selected ? (
          <KeyPanel key={selected} db={db} id={selected} readonly={readonly} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <KeyRound className="size-6 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Select a key</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a key on the left to see and edit its value.
              </p>
            </div>
            {!readonly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <Plus /> New key
              </Button>
            )}
          </div>
        )}
      </section>
      <NewKeyDialog db={db} open={creating} onOpenChange={setCreating} />
    </div>
  );
}
