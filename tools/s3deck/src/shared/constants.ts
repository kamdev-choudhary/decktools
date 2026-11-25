/** Header every state-changing API call must carry (CSRF protection). */
export const CSRF_HEADER = 'x-s3deck-csrf';
export const CSRF_VALUE = '1';

export const SESSION_COOKIE = 's3deck_session';

export const DEFAULT_PORT = 47715;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_USER = 'admin';
export const DEFAULT_REGION = 'us-east-1';

/** S3 limits */
export const MAX_DELETE_BATCH = 1000;
export const MAX_SINGLE_COPY_BYTES = 5 * 1024 ** 3; // 5 GiB
export const MIN_PRESIGN_SECONDS = 60;
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const MAX_TAGS = 10;

/** How many bytes of a file the text previews fetch. */
export const PREVIEW_TEXT_BYTES = 512 * 1024;
