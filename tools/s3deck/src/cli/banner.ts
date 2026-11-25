import { networkInterfaces } from 'node:os';
import pc from 'picocolors';

export interface BannerInfo {
  version: string;
  connection:
    | { ok: true; providerName: string; endpoint: string | null; region: string; bucketCount: number | null; pinned: number }
    | { ok: false; message: string };
  url: string;
  host: string;
  port: number;
  auth: { enabled: boolean; user: string; password: string; generated: boolean };
  readonly: boolean;
  browserConnections: boolean;
  dev: boolean;
  data: { dir: string; users: number; savedConnections: number; sso: string | null };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
}

export function printBanner(b: BannerInfo) {
  const label = (s: string) => pc.dim(s.padEnd(11));
  const lines: string[] = ['', `  ${pc.bold('s3deck')} ${pc.dim(`v${b.version}`)}`, ''];

  if (b.connection.ok) {
    const c = b.connection;
    const where = c.endpoint ? `${c.providerName} at ${c.endpoint}` : c.providerName;
    lines.push(`  ${pc.green('✓')} ${label('Connected')} ${where} ${pc.dim(`(region ${c.region})`)}`);
    const count = c.bucketCount !== null ? `${c.bucketCount} available` : `${c.pinned} configured (key can't list buckets)`;
    lines.push(`    ${label('Buckets')} ${count}`);
  } else {
    lines.push(`  ${pc.yellow('!')} ${label('No storage')} ${b.connection.message}`);
    lines.push(
      `    ${label('')} ${
        b.data.savedConnections
          ? 'Remembered connections are available after signing in.'
          : b.browserConnections
            ? 'Enter credentials in the browser to connect.'
            : pc.red('Browser connections are disabled.')
      }`,
    );
  }

  lines.push(`  ${pc.cyan('➜')} ${label('Web UI')} ${pc.cyan(pc.underline(b.url))}`);
  if (b.dev) lines.push(`    ${label('Dev UI')} ${pc.cyan('http://localhost:47716/')} ${pc.dim('(Vite, hot reload)')}`);

  if (LOOPBACK.has(b.host)) {
    lines.push(`    ${label('Reachable')} from this machine only ${pc.dim(`(remote: ssh -L ${b.port}:127.0.0.1:${b.port} …)`)}`);
  } else if (b.host === '0.0.0.0' || b.host === '::') {
    const lan = lanAddresses().map((a) => `http://${a}:${b.port}/`);
    lines.push(`    ${label('Reachable')} on all interfaces${lan.length ? ` ${pc.dim(lan.join('  '))}` : ''}`);
  } else {
    lines.push(`    ${label('Reachable')} on ${b.host}`);
  }

  if (b.auth.enabled) {
    lines.push(`    ${label('Login')} ${b.auth.user} / ${b.auth.generated ? pc.bold(b.auth.password) : pc.dim('(your password)')}`);
  } else {
    lines.push(`    ${label('Login')} ${pc.yellow('disabled (--no-auth)')}`);
  }
  if (b.readonly) lines.push(`    ${label('Mode')} read-only`);
  lines.push(`    ${label('Data')} ${b.data.dir}`);
  const extras = [
    b.data.users ? `${b.data.users} user${b.data.users === 1 ? '' : 's'}` : '',
    b.data.savedConnections ? `${b.data.savedConnections} remembered connection${b.data.savedConnections === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  if (extras.length) lines.push(`    ${label('')} ${pc.dim(extras.join(' · '))}`);
  if (b.data.sso) lines.push(`    ${label('SSO')} ${b.data.sso}`);

  if (!b.auth.enabled && !LOOPBACK.has(b.host)) {
    lines.push('', `  ${pc.red('⚠')}  ${pc.red(pc.bold('Login is disabled on a public interface.'))} Anyone who can reach this port gets full access to your storage.`);
  }
  lines.push('');
  console.log(lines.join('\n'));
}
