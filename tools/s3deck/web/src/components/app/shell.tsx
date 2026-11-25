import type { ConnectionsResponse, MeResponse } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { invalidateBucket } from '@/api/hooks';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { navigate, useRoute } from '@/lib/router';
import { uploadQueue } from '@/lib/upload-queue';
import { cn } from '@/lib/utils';
import { BucketSettingsView } from '@/views/bucket-settings';
import { ActivityView } from '@/views/activity';
import { BucketsHome } from '@/views/buckets';
import { SyncView } from '@/views/sync';
import { UsersView } from '@/views/users';
import { ObjectBrowser } from '@/views/object-browser';
import { AppContext, onAction, type AppState } from './app-context';
import { CommandMenu } from './command-menu';
import { ConnectionForm } from './connection-form';
import { IconButton } from './icon-button';
import { Sidebar } from './sidebar';
import { UploadPanel } from './upload-panel';

export function Shell({ me, connections }: { me: MeResponse; connections: ConnectionsResponse }) {
  const route = useRoute();
  const qc = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const state = useMemo<AppState>(() => {
    const connection = connections.connections.find((c) => c.id === connections.activeId)!;
    return { me, connection, connections: connections.connections, readonly: !me.can.write, isAdmin: me.can.admin };
  }, [me, connections]);

  // Refresh listings as uploads finish.
  useEffect(() => uploadQueue.onComplete((bucket) => void invalidateBucket(qc, bucket)), [qc]);
  useEffect(() => onAction((a) => a === 'add-connection' && setAddOpen(true)), []);
  // Close the mobile nav on navigation.
  const navKey = `${route.bucket}\u0000${route.view}`;
  const [navFor, setNavFor] = useState(navKey);
  if (navFor !== navKey) {
    setNavFor(navKey);
    setNavOpen(false);
  }

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-full">
        <div
          className={cn('fixed inset-0 z-30 bg-black/40 md:hidden', navOpen ? 'block' : 'hidden')}
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
        <Sidebar
          className={cn(
            'fixed inset-y-0 left-0 z-40 transition-transform md:static md:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
            <IconButton label="Open navigation" onClick={() => setNavOpen(true)}>
              <Menu />
            </IconButton>
            <span className="truncate text-sm font-medium">
              {route.bucket ?? (route.view !== 'browse' ? route.view : 's3deck')}
            </span>
          </div>
          {route.view === 'sync' ? (
            <SyncView />
          ) : route.view === 'activity' && me.can.admin ? (
            <ActivityView />
          ) : route.view === 'users' && me.can.admin ? (
            <UsersView />
          ) : !route.bucket ? (
            <BucketsHome />
          ) : route.view === 'settings' ? (
            <BucketSettingsView key={route.bucket} bucket={route.bucket} />
          ) : (
            <ObjectBrowser key={route.bucket} bucket={route.bucket} />
          )}
        </main>
      </div>
      <UploadPanel />
      <CommandMenu />
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>Connect to another account, endpoint or provider.</DialogDescription>
          </DialogHeader>
          <ConnectionForm
            onConnected={() => {
              setAddOpen(false);
              navigate({});
            }}
            onCancel={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </AppContext.Provider>
  );
}
