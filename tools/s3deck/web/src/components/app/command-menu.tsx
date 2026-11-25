import { Database, FolderPlus, FolderUp, Moon, PlugZap, Plus, RefreshCw, Settings, Sun, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorText } from '@/api/client';
import { useActivateConnection, useBuckets } from '@/api/hooks';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { navigate, useRoute } from '@/lib/router';
import { useTheme } from '@/lib/theme';
import { modKey } from '@/lib/utils';
import { dispatchAction, useApp, type AppAction } from './app-context';

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const route = useRoute();
  const { connection, connections, readonly, me } = useApp();
  const buckets = useBuckets();
  const activate = useActivateConnection();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('s3deck:command', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('s3deck:command', onOpen);
    };
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    // Let this dialog close before another one opens.
    setTimeout(fn, 0);
  };
  const act = (a: AppAction) => run(() => dispatchAction(a));
  const inBucket = !!route.bucket && route.view === 'browse';

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command menu"
      description="Jump to a bucket or run a command"
    >
      <CommandInput placeholder="Jump to a bucket or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {inBucket && !readonly && (
          <>
            <CommandGroup heading="This folder">
              <CommandItem onSelect={() => act('upload')}>
                <Upload /> Upload files
                <CommandShortcut>{modKey}U</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => act('upload-folder')}>
                <FolderUp /> Upload a folder
              </CommandItem>
              <CommandItem onSelect={() => act('new-folder')}>
                <FolderPlus /> New folder
              </CommandItem>
              <CommandItem onSelect={() => act('refresh')}>
                <RefreshCw /> Refresh
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Buckets">
          {(buckets.data?.buckets ?? []).map((b) => (
            <CommandItem
              key={b.name}
              value={`bucket ${b.name}`}
              onSelect={() => run(() => navigate({ bucket: b.name }))}
            >
              <Database /> {b.name}
            </CommandItem>
          ))}
          {route.bucket && (
            <CommandItem onSelect={() => run(() => navigate({ bucket: route.bucket, view: 'settings' }))}>
              <Settings /> Settings for {route.bucket}
            </CommandItem>
          )}
        </CommandGroup>
        <CommandSeparator />

        <CommandGroup heading="Connections">
          {connections
            .filter((c) => c.id !== connection.id)
            .map((c) => (
              <CommandItem
                key={c.id}
                value={`connection ${c.label}`}
                onSelect={() =>
                  run(() =>
                    activate.mutate(c.id, {
                      onSuccess: () => navigate({}),
                      onError: (e) => toast.error(errorText(e)),
                    }),
                  )
                }
              >
                <PlugZap /> Switch to {c.label}
              </CommandItem>
            ))}
          {me.browserConnections && (
            <CommandItem onSelect={() => act('add-connection')}>
              <Plus /> Add connection…
            </CommandItem>
          )}
        </CommandGroup>
        <CommandSeparator />

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => run(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <Sun /> : <Moon />} Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
