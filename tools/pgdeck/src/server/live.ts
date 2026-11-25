import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { DatabaseManager } from '../db/index.js';
import type { LiveMessage } from '../shared/types.js';

const INTERVAL_MS = 2000;
const LIVE_PATH = /^\/api\/db\/([^/]+)\/live$/;

interface Channel {
  clients: Set<WebSocket>;
  timer: NodeJS.Timeout;
}

export interface LiveOptions {
  manager: DatabaseManager;
  basePath: string;
  authorizeCookieHeader: (cookie: string | undefined) => boolean;
}

/**
 * Pushes live database metrics over WebSockets at /api/db/<name>/live.
 * One sampler per database is shared by all its viewers and stops when the
 * last one disconnects.
 */
export function createLiveHub({ manager, basePath, authorizeCookieHeader }: LiveOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const channels = new Map<string, Channel>();

  const send = (ws: WebSocket, msg: LiveMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  async function join(dbName: string, ws: WebSocket) {
    let channel = channels.get(dbName);
    if (!channel) {
      let sample = (await manager.get(dbName)).liveSampler();
      const clients = new Set<WebSocket>();
      let busy = false;
      const tick = async () => {
        if (busy) return; // skip a beat rather than pile up queries on a slow server
        busy = true;
        try {
          const msg = JSON.stringify(await sample());
          for (const c of clients) if (c.readyState === c.OPEN) c.send(msg);
        } catch (err) {
          // The pool was closed (database renamed, copied or dropped); reopen on the next beat.
          if (/after calling end/i.test((err as Error).message)) {
            sample = await manager
              .get(dbName)
              .then((db) => db.liveSampler())
              .catch(() => sample);
            return;
          }
          const msg: LiveMessage = { type: 'error', error: (err as Error).message };
          for (const c of clients) send(c, msg);
        } finally {
          busy = false;
        }
      };
      channel = { clients, timer: setInterval(tick, INTERVAL_MS) };
      channels.set(dbName, channel);
      clients.add(ws);
      void tick();
    } else {
      channel.clients.add(ws);
    }

    ws.on('close', () => {
      const ch = channels.get(dbName);
      if (!ch) return;
      ch.clients.delete(ws);
      if (!ch.clients.size) {
        clearInterval(ch.timer);
        channels.delete(dbName);
      }
    });
  }

  /** Browsers don't preflight WebSockets, so check Origin to stop cross-site use of the cookie. */
  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients
    const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ?? req.headers.host;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  function reject(socket: Duplex, status: number, text: string) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  /** Handle an HTTP upgrade. Returns false if the path isn't ours. */
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let pathname = new URL(req.url ?? '/', 'http://local').pathname;
    if (basePath && pathname.startsWith(basePath + '/')) pathname = pathname.slice(basePath.length);
    const match = LIVE_PATH.exec(pathname);
    if (!match) return false;

    if (!sameOrigin(req)) {
      reject(socket, 403, 'Forbidden');
      return true;
    }
    if (!authorizeCookieHeader(req.headers.cookie)) {
      reject(socket, 401, 'Unauthorized');
      return true;
    }

    const dbName = decodeURIComponent(match[1]!);
    wss.handleUpgrade(req, socket, head, (ws) => {
      join(dbName, ws).catch((err: Error) => {
        send(ws, { type: 'error', error: err.message });
        ws.close(1011, 'unavailable');
      });
    });
    return true;
  }

  function close() {
    for (const ch of channels.values()) clearInterval(ch.timer);
    channels.clear();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  }

  return { handleUpgrade, close };
}
