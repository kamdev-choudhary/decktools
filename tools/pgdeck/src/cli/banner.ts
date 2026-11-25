import { printBanner as printDeckBanner, label } from '@deck/cli';
import { colors as pc, symbols } from '@deck/logger';
import type { DbInfo } from '../shared/types.js';
import type { AppConfig } from './config.js';

export function printBanner(
  version: string,
  config: AppConfig,
  info: DbInfo,
  databaseCount: number,
  url: string,
  port: number,
): void {
  const serverVersion = info.version.split(' ').slice(0, 2).join(' ');
  printDeckBanner({
    name: 'pgdeck',
    version,
    server: config,
    url,
    port,
    resource: 'database',
    before: [
      `  ${symbols.ok} ${label('Connected')}${pc.bold(info.database)} as ${info.user} ${pc.dim(`(${serverVersion})`)}`,
      `    ${label('Databases')}${databaseCount} available ${pc.dim('(switch in the UI)')}`,
    ],
    after: config.readonly ? [`    ${label('Mode')}${pc.yellow('read-only')}`] : [],
  });
}
