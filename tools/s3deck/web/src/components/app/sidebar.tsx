import {
  Bookmark,
  Check,
  ChevronDown,
  Database,
  FolderSync,
  History,
  UserRound,
  LogOut,
  Monitor,
  Moon,
  Plus,
  PlugZap,
  Search,
  Settings,
  Sun,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorText } from '@/api/client';
import { useActivateConnection, useBuckets, useLogout, useRemoveConnection } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { IconButton } from './icon-button';
import { hrefFor, navigate, useRoute } from '@/lib/router';
import { useTheme } from '@/lib/theme';
import { cn, modKey } from '@/lib/utils';
import { dispatchAction, useApp } from './app-context';
import { CreateBucketDialog } from './bucket-dialogs';
import { Logo } from './logo';

function ConnectionSwitcher() {
  const { connection, connections, me } = useApp();
  const activate = useActivateConnection();
  const remove = useRemoveConnection();

  const switchTo = (id: string) =>
    activate.mutate(id, {
      onSuccess: () => navigate({}),
      onError: (e) => toast.error(errorText(e)),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left">
          <Logo className="!size-7 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight">{connection.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {connection.providerName} · {connection.region}
            </span>
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Connections</DropdownMenuLabel>
        {connections.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => c.id !== connection.id && switchTo(c.id)}>
            <PlugZap />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {c.endpoint ?? 'AWS'} {c.accessKeyHint && `· ${c.accessKeyHint}`}
              </span>
            </span>
            {c.source === 'saved' && <Bookmark className="size-3.5" aria-label="Remembered" />}
            {c.id === connection.id && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
        {me.browserConnections && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => dispatchAction('add-connection')}>
              <Plus /> Add connection…
            </DropdownMenuItem>
          </>
        )}
        {connection.source !== 'cli' && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              remove.mutate(connection.id, {
                onSuccess: () => navigate({}),
                onError: (e) => toast.error(errorText(e)),
              })
            }
          >
            <Unplug /> {connection.source === 'saved' ? 'Forget' : 'Disconnect'} “{connection.label}”
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        {(['light', 'dark', 'system'] as const).map((t) => (
          <DropdownMenuItem key={t} onSelect={() => setTheme(t)} className="capitalize">
            {t === 'light' ? <Sun /> : t === 'dark' ? <Moon /> : <Monitor />}
            {t}
            {theme === t && <Check className="ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({ className }: { className?: string }) {
  const { me, connection, isAdmin } = useApp();
  const route = useRoute();
  const buckets = useBuckets();
  const logout = useLogout();
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const list = (buckets.data?.buckets ?? []).filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()));
  const canCreate = isAdmin && !me.readonly && connection.capabilities.bucketCreate && !buckets.data?.fallback;
  const navItem = (view: 'sync' | 'activity' | 'users', label: string, Icon: typeof FolderSync) => {
    const active = route.view === view;
    return (
      <a
        href={hrefFor({ view })}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate({ view });
        }}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          active ? 'bg-primary/10 font-medium text-primary dark:bg-primary/15' : 'text-foreground/80 hover:bg-muted',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
        {label}
      </a>
    );
  };

  return (
    <aside className={cn('flex h-full w-64 shrink-0 flex-col border-r bg-sidebar', className)}>
      <div className="p-2">
        <ConnectionSwitcher />
      </div>

      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Buckets</span>
        {canCreate && (
          <IconButton label="New bucket" onClick={() => setCreateOpen(true)}>
            <Plus />
          </IconButton>
        )}
      </div>
      {(buckets.data?.buckets.length ?? 0) > 6 && (
        <div className="px-3 pb-1">
          <InputGroup className="h-8">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter buckets" aria-label="Filter buckets" />
          </InputGroup>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-1" aria-label="Buckets">
        {buckets.isPending && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {buckets.isError && <p className="px-2 py-3 text-xs text-destructive">{errorText(buckets.error)}</p>}
        {list.map((b) => {
          const active = route.bucket === b.name;
          return (
            <a
              key={b.name}
              href={hrefFor({ bucket: b.name })}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate({ bucket: b.name });
              }}
              className={cn(
                'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                active ? 'bg-primary/10 font-medium text-primary dark:bg-primary/15' : 'text-foreground/80 hover:bg-muted',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Database className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className="truncate">{b.name}</span>
              {active && (
                <IconButton
                  label="Bucket settings"
                  size="icon-xs"
                  className="ml-auto opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate({ bucket: b.name, view: 'settings' });
                  }}
                >
                  <Settings />
                </IconButton>
              )}
            </a>
          );
        })}
        {buckets.data && list.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">{filter ? 'No matching buckets' : 'No buckets yet'}</p>
        )}
      </nav>

      <nav className="space-y-0.5 border-t p-2" aria-label="Tools">
        {navItem('sync', 'Sync', FolderSync)}
        {isAdmin && navItem('activity', 'Activity', History)}
        {isAdmin && navItem('users', 'Users', UserRound)}
      </nav>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="mb-1 w-full justify-start text-muted-foreground"
          onClick={() => window.dispatchEvent(new Event('s3deck:command'))}
        >
          <Search /> Jump to…
          <KbdGroup className="ml-auto">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <div className="flex items-center gap-1 px-1">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {me.user && me.authRequired ? me.user : 's3deck'} · v{me.version}
          </span>
          {me.readonly ? (
            <Badge variant="secondary">read-only</Badge>
          ) : (
            me.role && me.role !== 'admin' && <Badge variant="outline" className="capitalize">{me.role}</Badge>
          )}
          <ThemeMenu />
          {me.authRequired && (
            <IconButton label="Log out" onClick={() => logout.mutate()}>
              <LogOut />
            </IconButton>
          )}
        </div>
      </div>

      <CreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} />
    </aside>
  );
}
