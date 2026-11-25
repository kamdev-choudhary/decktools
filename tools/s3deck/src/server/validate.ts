import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { formatZodError } from '../shared/schemas';

/** zod validation for a request part, answering 400 with a readable message on failure. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: { code: 'VALIDATION', message: formatZodError(result.error) } }, 400);
    }
  });
}
