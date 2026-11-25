import type { Context } from 'hono';
import pg from 'pg';
import type { ApiErrorBody } from '../../shared/types.js';
import { UserError } from '../../db/errors.js';

/** Map pgdeck's own and Postgres' errors to responses; anything else becomes a logged 500. */
export function mapError(err: Error, c: Context): Response | undefined {
  if (err instanceof UserError) {
    return c.json<ApiErrorBody>({ error: err.message }, err.status);
  }

  // Errors raised by Postgres itself (syntax, constraint, permission...) are the
  // user's to fix, so pass through everything the server told us.
  if (err instanceof pg.DatabaseError) {
    return c.json<ApiErrorBody>(
      {
        error: err.message,
        // `where` carries COPY context such as "COPY users, line 1042, column email".
        detail: [err.detail, err.where].filter(Boolean).join('\n') || undefined,
        hint: err.hint,
        position: err.position,
        code: err.code,
      },
      400,
    );
  }
  return undefined;
}
