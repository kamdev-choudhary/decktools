import { listen, type RunningServer } from '@deck/server';
import { createApp, type AppOptions } from './app.js';

export type { RunningServer } from '@deck/server';

export interface StartOptions extends AppOptions {
  port: number;
  host: string;
}

export function startServer({ port, host, ...appOptions }: StartOptions): Promise<RunningServer> {
  const { app } = createApp(appOptions);
  return listen({ fetch: app.fetch, port, host });
}
