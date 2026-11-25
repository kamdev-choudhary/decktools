import type { ConnectionInfo, MeResponse } from '@shared/types';
import { createContext, useContext } from 'react';

export interface AppState {
  me: MeResponse;
  connection: ConnectionInfo;
  connections: ConnectionInfo[];
  /** True when this user can't change objects (read-only mode or viewer role). */
  readonly: boolean;
  /** Buckets, bucket settings, users and the activity log. */
  isAdmin: boolean;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppContext');
  return ctx;
}

/** Fire-and-forget UI actions (from the command menu or shortcuts) that a view handles. */
export type AppAction = 'upload' | 'upload-folder' | 'new-folder' | 'refresh' | 'add-connection' | 'new-bucket';

export function dispatchAction(action: AppAction) {
  window.dispatchEvent(new CustomEvent<AppAction>('s3deck:action', { detail: action }));
}

export function onAction(fn: (a: AppAction) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<AppAction>).detail);
  window.addEventListener('s3deck:action', handler);
  return () => window.removeEventListener('s3deck:action', handler);
}
