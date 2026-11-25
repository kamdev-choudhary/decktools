import { listen, type RunningServer } from '@deck/server';
import { createApp, type AppOptions } from './app.js';
import { createLiveHub } from './live.js';

export type { AuthConfig } from './app.js';
export type { RunningServer } from '@deck/server';

export interface StartOptions extends AppOptions {
  port: number;
  host: string;
}

/** Start listening (HTTP + live WebSocket). Resolves once the port is bound. */
export function startServer({ port, host, ...appOptions }: StartOptions): Promise<RunningServer> {
  const { app, authorizeCookieHeader } = createApp(appOptions);
  const live = createLiveHub({ manager: appOptions.manager, basePath: appOptions.basePath, authorizeCookieHeader });
  return listen({ fetch: app.fetch, port, host, onUpgrade: live.handleUpgrade, onClose: live.close });
}
