import openUrl from 'open';
import { colors as pc } from '@deck/logger';

/** Message for a failed listen(), with a hint when the port is taken. */
export function listenErrorMessage(err: unknown, port: number): string {
  const e = err as NodeJS.ErrnoException;
  return e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port ${port + 1}` : e.message;
}

/** Open the UI in the default browser; failures (headless boxes, no browser) are ignored. */
export function openBrowser(url: string): void {
  openUrl(url).catch(() => {});
}

/**
 * Run `cleanup` on Ctrl+C / SIGTERM, then exit. A second signal while cleanup
 * is still running exits immediately with status 1.
 */
export function onShutdown(cleanup: () => void | Promise<void>): void {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(pc.dim('\n  Shutting down...'));
    await cleanup();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
