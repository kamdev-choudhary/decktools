import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { createApp, type AppOptions } from './app.js';
import { createLiveHub } from './live.js';

export type { AuthConfig } from './app.js';

export interface StartOptions extends AppOptions {
  port: number;
  host: string;
}

export interface RunningServer {
  server: ServerType;
  port: number;
  close: () => void;
}

/** Start listening (HTTP + live WebSocket). Resolves once the port is bound. */
export function startServer({ port, host, ...appOptions }: StartOptions): Promise<RunningServer> {
  const { app, authorizeCookieHeader } = createApp(appOptions);
  const live = createLiveHub({ manager: appOptions.manager, basePath: appOptions.basePath, authorizeCookieHeader });

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: host }, (info: AddressInfo) => {
      server.off('error', reject);
      resolve({
        server,
        port: info.port,
        close: () => {
          live.close();
          server.close();
        },
      });
    });
    (server as Server).on('upgrade', (req, socket, head) => {
      if (!live.handleUpgrade(req, socket, head)) socket.destroy();
    });
    server.once('error', reject);
  });
}
