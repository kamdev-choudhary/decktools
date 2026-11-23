import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import pg from 'pg';
import type { ApiErrorBody } from '../../shared/types.js';
import { UserError } from '../../db/errors.js';

export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) return err.getResponse();

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

  console.error('[pgdeck]', err);
  return c.json<ApiErrorBody>({ error: err.message || 'Internal error' }, 500);
};
