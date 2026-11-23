import pc from 'picocolors';
import type { DbInfo } from '../shared/types.js';
import { isLoopback, type AppConfig } from './config.js';

export function printBanner(
  version: string,
  config: AppConfig,
  info: DbInfo,
  databaseCount: number,
  url: string,
  port: number,
): void {
  const label = (s: string) => pc.dim(s.padEnd(12));
  const serverVersion = info.version.split(' ').slice(0, 2).join(' ');

  const lines = [
    '',
    `  ${pc.bold(pc.blue('pgdeck'))} ${pc.dim(`v${version}`)}`,
    '',
    `  ${pc.green('✓')} ${label('Connected')}${pc.bold(info.database)} as ${info.user} ${pc.dim(`(${serverVersion})`)}`,
    `    ${label('Databases')}${databaseCount} available ${pc.dim('(switch in the UI)')}`,
    `  ${pc.cyan('➜')} ${label('Web UI')}${pc.bold(pc.cyan(url))}`,
    `    ${label('Listening')}${config.host}:${port}${config.basePath ? pc.dim(`  (base path ${config.basePath})`) : ''}`,
  ];

  if (config.auth) {
    const hint = config.auth.generated ? pc.dim('  (generated: pass --password to keep it fixed)') : '';
    lines.push(`    ${label('Login')}${config.auth.username} / ${pc.yellow(config.auth.password)}${hint}`);
  } else {
    lines.push(`    ${label('Login')}${pc.yellow('disabled (--no-auth)')}`);
  }

  if (config.readonly) lines.push(`    ${label('Mode')}${pc.yellow('read-only')}`);

  if (!config.auth && !isLoopback(config.host)) {
    lines.push(
      '',
      pc.red(`  ⚠ Auth is off and ${config.host} is reachable from the network.`),
      pc.red('    Anyone who can reach this port can read and modify the database.'),
    );
  }

  lines.push('', pc.dim('  Press Ctrl+C to stop.'), '');
  console.log(lines.join('\n'));
}
