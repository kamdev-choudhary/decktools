import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { KeyAction, LoginRequest, NewKey, SessionInfo, StatsSample } from '@shared/types';
import { api } from './client';

export const keys = {
  session: ['session'] as const,
  server: ['server'] as const,
  keyList: (db: number) => ['keys', db] as const,
  key: (db: number, id: string) => ['key', db, id] as const,
};

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: api.session, staleTime: Infinity });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.login(body),
    onSuccess: (session) => qc.setQueryData<SessionInfo>(keys.session, session),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: (session) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      qc.setQueryData<SessionInfo>(keys.session, session);
    },
  });
}

export const useServer = () => useQuery({ queryKey: keys.server, queryFn: api.server, staleTime: 10_000 });

export const useSlowlog = () => useQuery({ queryKey: ['slowlog'], queryFn: api.slowlog, refetchInterval: 10_000 });

export const useDbSize = (db: number) =>
  useQuery({ queryKey: ['size', db], queryFn: () => api.size(db), refetchInterval: 15_000 });

/** Keys matching a pattern, fetched page by page with SCAN. */
export function useKeyList(db: number, match: string, type: string) {
  return useInfiniteQuery({
    queryKey: [...keys.keyList(db), match, type],
    queryFn: ({ pageParam }) => api.keys(db, { cursor: pageParam, match: match || '*', type: type || undefined }),
    initialPageParam: '0',
    getNextPageParam: (last) => (last.cursor === '0' ? undefined : last.cursor),
  });
}

export const useKeyDetail = (db: number, id: string | null) =>
  useQuery({ queryKey: keys.key(db, id ?? ''), queryFn: () => api.key(db, id!), enabled: !!id, staleTime: 0 });

/** Change a key, then refresh it (and the key list when names or membership change). */
export function useKeyAction(db: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: KeyAction) => api.action(db, action),
    onSuccess: (_res, action) => {
      if (action.op === 'delete' || action.op === 'rename' || action.op === 'expire') {
        void qc.invalidateQueries({ queryKey: keys.keyList(db) });
        void qc.invalidateQueries({ queryKey: ['size', db] });
      }
      if (action.op === 'delete') for (const id of action.ids) qc.removeQueries({ queryKey: keys.key(db, id) });
      else void qc.invalidateQueries({ queryKey: keys.key(db, action.id) });
    },
  });
}

export function useCreateKey(db: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spec: NewKey) => api.create(db, spec),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.keyList(db) });
      void qc.invalidateQueries({ queryKey: ['size', db] });
    },
  });
}

/** The server's command catalog; it only changes with the Redis version. */
export const useCommandDocs = () => useQuery({ queryKey: ['commands'], queryFn: api.commands, staleTime: Infinity });

export const useCommand = (db: number) => useMutation({ mutationFn: (command: string) => api.command(db, command) });

export const STATS_WINDOW = 60; // samples kept: 2 minutes at one every 2 s

/** Poll live stats every 2 s while mounted, keeping the last STATS_WINDOW samples. */
export function useLiveStats() {
  const [samples, setSamples] = useState<StatsSample[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await api.stats();
        if (stopped) return;
        setError(null);
        setSamples((prev) => [...prev.slice(-(STATS_WINDOW - 1)), s]);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return { samples, latest: samples.at(-1), error };
}
