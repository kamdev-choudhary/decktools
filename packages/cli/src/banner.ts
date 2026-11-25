import { isLoopback, isWildcardHost, type ServerConfig } from '@deck/config';
import { colors as pc, label, symbols } from '@deck/logger';

export { label };

export interface BannerOptions {
  /** Tool name, e.g. "pgdeck". */
  name: string;
  version: string;
  server: Pick<ServerConfig, 'host' | 'auth' | 'basePath'>;
  url: string;
  port: number;
  /** Tool lines shown above "Web UI", e.g. what it connected to. */
  before?: string[];
  /** Tool lines shown after "Login", e.g. a read-only notice. */
  after?: string[];
  /** What an unauthenticated visitor could modify, for the exposure warning (default "data"). */
  resource?: string;
}

/** The startup summary every deck prints: URL, who can reach it, how to log in. */
export function formatBanner({ name, version, server, url, port, before = [], after = [], resource = 'data' }: BannerOptions): string {
  const lines = [
    '',
    `  ${pc.bold(pc.blue(name))} ${pc.dim(`v${version}`)}`,
    '',
    ...before,
    `  ${symbols.arrow} ${label('Web UI')}${pc.bold(pc.cyan(url))}`,
    // Say who can reach the UI, rather than repeating the address above.
    isLoopback(server.host)
      ? `    ${label('Reachable')}from this machine only ${pc.dim(`(remote: ssh -L ${port}:127.0.0.1:${port} <server>, a reverse proxy, or --host 0.0.0.0)`)}`
      : `    ${label('Reachable')}from the network on ${isWildcardHost(server.host) ? 'all interfaces' : server.host}, port ${port}`,
  ];
  if (server.basePath) lines.push(`    ${label('Base path')}${server.basePath}`);

  if (server.auth) {
    const hint = server.auth.generated ? pc.dim('  (generated: pass --password to keep it fixed)') : '';
    lines.push(`    ${label('Login')}${server.auth.username} / ${pc.yellow(server.auth.password)}${hint}`);
  } else {
    lines.push(`    ${label('Login')}${pc.yellow('disabled (--no-auth)')}`);
  }

  lines.push(...after);

  if (!server.auth && !isLoopback(server.host)) {
    lines.push(
      '',
      pc.red(`  ⚠ Auth is off and ${server.host} is reachable from the network.`),
      pc.red(`    Anyone who can reach this port can read and modify the ${resource}.`),
    );
  }

  lines.push('', pc.dim('  Press Ctrl+C to stop.'), '');
  return lines.join('\n');
}

export function printBanner(opts: BannerOptions): void {
  console.log(formatBanner(opts));
}
