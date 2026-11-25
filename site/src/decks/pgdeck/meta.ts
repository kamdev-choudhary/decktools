import { docsUrl, getVersion, npmUrl } from '../../lib/meta';
import { deck } from '../index';

export const PGDECK = deck('pgdeck');
export const DOCS_URL = docsUrl('pgdeck');
export const NPM_URL = npmUrl('pgdeck');
export const getPgdeckVersion = () => getVersion('pgdeck', PGDECK.fallbackVersion!);
