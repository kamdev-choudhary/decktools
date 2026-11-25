import { docsUrl, getVersion, npmUrl } from '../../lib/meta';
import { deck } from '../index';

export const S3DECK = deck('s3deck');
export const DOCS_URL = docsUrl('s3deck');
export const NPM_URL = npmUrl('s3deck');
export const getS3deckVersion = () => getVersion('s3deck', S3DECK.fallbackVersion!);
