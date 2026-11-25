import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { serve, type ServerType } from '@hono/node-server';

export interface ListenOptions {
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  host: string;
  /** Handle a WebSocket upgrade; return false (or omit) to reject it. */
  onUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  /** Extra cleanup when the server is closed, e.g. stopping live channels. */
  onClose?: () => void;
}

export interface RunningServer {
  server: ServerType;
  port: number;
  close: () => void;
}

/** Start listening (HTTP + optional WebSocket upgrades). Resolves once the port is bound. */
export function listen({ fetch, port, host, onUpgrade, onClose }: ListenOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname: host }, (info: AddressInfo) => {
      server.off('error', reject);
      resolve({
        server,
        port: info.port,
        close: () => {
          onClose?.();
          server.close();
        },
      });
    });
    // Large uploads can take far longer than Node's default 5-minute request timeout.
    (server as Server).requestTimeout = 0;
    (server as Server).on('upgrade', (req, socket, head) => {
      if (!onUpgrade?.(req, socket, head)) socket.destroy();
    });
    server.once('error', reject);
  });
}
