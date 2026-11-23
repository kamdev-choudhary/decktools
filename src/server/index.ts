import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { createApp, type AppOptions } from './app.js';

export type { AuthConfig } from './app.js';

export interface StartOptions extends AppOptions {
  port: number;
  host: string;
}

/** Start listening. Resolves with the server and the port actually bound. */
export function startServer({ port, host, ...appOptions }: StartOptions): Promise<{ server: ServerType; port: number }> {
  const app = createApp(appOptions);
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: host }, (info: AddressInfo) => {
      server.off('error', reject);
      resolve({ server, port: info.port });
    });
    server.once('error', reject);
  });
}
