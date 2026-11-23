import { useEffect, useState } from 'react';
import type { LiveMessage, LiveSample } from '@shared/types';
import { BASE } from './client';

export type LiveStatus = 'connecting' | 'live' | 'offline';

const WINDOW = 60; // samples kept (2 min at the server's 2 s interval)

/**
 * Subscribe to /api/db/<db>/live. Keeps the last WINDOW samples and
 * reconnects with exponential backoff if the socket drops.
 */
export function useLive(db: string) {
  const [samples, setSamples] = useState<LiveSample[]>([]);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    setSamples([]);

    const connect = () => {
      setStatus('connecting');
      const url = new URL(`${BASE}api/db/${encodeURIComponent(db)}/live`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry = 0;
        setStatus('live');
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as LiveMessage;
        if (msg.type === 'sample') {
          setError(null);
          setSamples((s) => [...s.slice(-(WINDOW - 1)), msg]);
        } else {
          setError(msg.error);
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [db]);

  return { samples, latest: samples.at(-1), status, error, window: WINDOW };
}
