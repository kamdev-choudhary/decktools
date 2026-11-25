import { label, printBanner as printDeckBanner } from '@deck/cli';
import { colors as pc, symbols } from '@deck/logger';
import type { ServerInfo } from '../shared/types.js';
import type { AppConfig } from './config.js';

export function printBanner(
  version: string,
  config: AppConfig,
  info: ServerInfo,
  address: string,
  url: string,
  port: number,
): void {
  const keys = info.keyspace.reduce((n, d) => n + d.keys, 0);
  const used = info.keyspace.length;
  printDeckBanner({
    name: 'redisdeck',
    version,
    server: config,
    url,
    port,
    resource: 'data',
    before: [
      `  ${symbols.ok} ${label('Connected')}${pc.bold(address)} ${pc.dim(`(${info.product === 'redis' ? 'Redis' : info.product} ${info.version}, ${info.role})`)}`,
      `    ${label('Keys')}${keys.toLocaleString()} in ${used} database${used === 1 ? '' : 's'} ${pc.dim(`(of ${info.databases})`)}`,
    ],
    after: config.readonly ? [`    ${label('Mode')}${pc.yellow('read-only')}`] : [],
  });
}
