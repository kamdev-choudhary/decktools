import { docsUrl, getVersion, npmUrl } from '../../lib/meta';
import { deck } from '../index';

export const REDISDECK = deck('redisdeck');
export const DOCS_URL = docsUrl('redisdeck');
export const NPM_URL = npmUrl('redisdeck');
export const getRedisdeckVersion = () => getVersion('redisdeck', REDISDECK.fallbackVersion!);
