import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { createApp } from './app';
import type { ServerContext } from './context';

/** Starts the HTTP server and resolves once it's listening. */
export function startServer(ctx: ServerContext): Promise<{ server: ServerType; port: number }> {
  const app = createApp(ctx);
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: ctx.config.host, port: ctx.config.port }, (info: AddressInfo) => {
      resolve({ server, port: info.port });
    });
    server.once('error', reject);
    // Large transfers can take a long time; don't cut them off.
    if ('requestTimeout' in server) server.requestTimeout = 0;
    if ('headersTimeout' in server) server.headersTimeout = 60_000;
  });
}
