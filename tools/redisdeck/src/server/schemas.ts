import { z } from 'zod';
import { UserError } from '../redis/errors.js';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new UserError(`Invalid request: ${z.prettifyError(result.error)}`);
  return result.data;
}

const id = z.string().min(1).max(1_000_000);
const text = z.string().max(64 * 1024 * 1024);
const ttl = z.number().int().positive().optional();

export const keysQuery = z.object({
  cursor: z.string().regex(/^\d+$/).default('0'),
  match: z.string().max(4096).default('*'),
  type: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(200),
});

export const keyQuery = z.object({
  id,
  cursor: z.string().max(64).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const actionBody = z.discriminatedUnion('op', [
  z.object({ op: z.literal('delete'), ids: z.array(id).min(1).max(10_000) }),
  z.object({ op: z.literal('rename'), id, newName: text.min(1) }),
  z.object({ op: z.literal('expire'), id, seconds: z.number().int().nullable() }),
  z.object({ op: z.literal('string.set'), id, value: text }),
  z.object({ op: z.literal('hash.set'), id, field: text, value: text, previousField: text.optional() }),
  z.object({ op: z.literal('hash.delete'), id, fields: z.array(text).min(1) }),
  z.object({ op: z.literal('list.set'), id, index: z.number().int(), value: text }),
  z.object({ op: z.literal('list.push'), id, value: text, end: z.enum(['head', 'tail']) }),
  z.object({ op: z.literal('list.delete'), id, index: z.number().int() }),
  z.object({ op: z.literal('set.add'), id, member: text, previous: text.optional() }),
  z.object({ op: z.literal('set.delete'), id, members: z.array(text).min(1) }),
  z.object({ op: z.literal('zset.add'), id, member: text, score: z.number(), previous: text.optional() }),
  z.object({ op: z.literal('zset.delete'), id, members: z.array(text).min(1) }),
  z.object({ op: z.literal('stream.add'), id, fields: z.record(z.string(), text) }),
  z.object({ op: z.literal('stream.delete'), id, entryIds: z.array(z.string().regex(/^\d+-\d+$/)).min(1) }),
  z.object({ op: z.literal('json.set'), id, json: text }),
]);

export const createBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('string'), name: text.min(1), value: text, ttl }),
  z.object({ type: z.literal('hash'), name: text.min(1), field: text, value: text, ttl }),
  z.object({ type: z.literal('list'), name: text.min(1), value: text, ttl }),
  z.object({ type: z.literal('set'), name: text.min(1), member: text, ttl }),
  z.object({ type: z.literal('zset'), name: text.min(1), member: text, score: z.number(), ttl }),
  z.object({ type: z.literal('stream'), name: text.min(1), field: text, value: text, ttl }),
  z.object({ type: z.literal('ReJSON-RL'), name: text.min(1), json: text, ttl }),
]);

export const commandBody = z.object({ command: z.string().min(1).max(1024 * 1024) });
