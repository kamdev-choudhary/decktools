import { z } from 'zod';
import { MAX_PRESIGN_SECONDS, MAX_TAGS, MIN_PRESIGN_SECONDS } from './constants';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Any existing bucket name. Lenient, since legacy buckets may not follow today's rules. */
export const bucketParamSchema = z.string().min(1).max(255);

/** Name for a bucket we create. Follows the S3 naming rules. */
export const newBucketNameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(63, 'At most 63 characters')
  .regex(
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
    'Lowercase letters, digits, dots and hyphens; start and end with a letter or digit',
  )
  .refine((v) => !/\.\.|\.-|-\./.test(v), 'No adjacent dots, or dots next to hyphens')
  .refine((v) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(v), 'Must not look like an IP address');

export const objectKeySchema = z
  .string()
  .min(1, 'Key is required')
  .refine((v) => new TextEncoder().encode(v).length <= 1024, 'Keys are limited to 1,024 bytes');

export const prefixSchema = z
  .string()
  .refine((v) => new TextEncoder().encode(v).length <= 1024, 'Prefix is limited to 1,024 bytes');

export const regionSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[a-zA-Z0-9-]*$/, 'Letters, digits and hyphens only');

const httpUrl = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Enter an http(s) URL, e.g. http://localhost:9000');

/* ------------------------------------------------------------------ */
/* Auth & connections                                                  */
/* ------------------------------------------------------------------ */

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(128),
  password: z.string().min(1, 'Password is required').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const pathStyleSchema = z.enum(['auto', 'path', 'virtual']);
export type PathStyle = z.infer<typeof pathStyleSchema>;

/** Credentials and endpoint a user enters in the browser. Sent once, kept server-side only. */
export const connectionInputSchema = z.object({
  label: z.string().trim().max(64).optional(),
  endpoint: z.union([z.literal(''), httpUrl]).optional(),
  region: regionSchema.optional(),
  accessKeyId: z.string().trim().min(1, 'Access key ID is required').max(256),
  secretAccessKey: z.string().min(1, 'Secret access key is required').max(1024),
  sessionToken: z.string().trim().max(8192).optional(),
  pathStyle: pathStyleSchema.optional(),
  buckets: z.array(bucketParamSchema).max(50).optional(),
  publicUrlBase: z.union([z.literal(''), httpUrl]).optional(),
  /** Keep this connection (encrypted on the server) across restarts. */
  remember: z.boolean().optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export const listQuerySchema = z.object({
  prefix: prefixSchema.default(''),
  cursor: z.string().max(4096).optional(),
  /** "1" lists every key under the prefix (no folders); used for search. */
  flat: z.enum(['0', '1']).default('0'),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const keyQuerySchema = z.object({
  key: objectKeySchema,
  versionId: z.string().max(1024).optional(),
});

export const downloadQuerySchema = keyQuerySchema.extend({
  inline: z.enum(['0', '1']).default('0'),
});

export const prefixQuerySchema = z.object({ prefix: prefixSchema.default('') });

/* ------------------------------------------------------------------ */
/* Object operations                                                   */
/* ------------------------------------------------------------------ */

export const uploadQuerySchema = z.object({
  key: objectKeySchema,
  contentType: z.string().max(255).optional(),
});

export const createFolderSchema = z.object({
  prefix: prefixSchema.refine((v) => v.length > 0 && v.endsWith('/'), 'Folder must end with "/"'),
});

export const deleteSchema = z
  .object({
    keys: z.array(objectKeySchema).max(100_000).default([]),
    prefixes: z
      .array(prefixSchema.refine((v) => v.endsWith('/'), 'Folders end with "/"'))
      .max(1000)
      .default([]),
  })
  .refine((v) => v.keys.length + v.prefixes.length > 0, 'Nothing to delete');
export type DeleteInput = z.input<typeof deleteSchema>;

export const summarySchema = z.object({
  keys: z.array(objectKeySchema).max(100_000).default([]),
  prefixes: z.array(prefixSchema).max(1000).default([]),
});

/** Copy or move. A source ending in "/" is a folder and copies everything under it. */
export const copySchema = z
  .object({
    destinationBucket: bucketParamSchema,
    move: z.boolean().default(false),
    items: z
      .array(
        z.object({
          source: objectKeySchema,
          destination: objectKeySchema,
        }),
      )
      .min(1)
      .max(10_000),
  })
  .refine(
    (v) => v.items.every((i) => i.source.endsWith('/') === i.destination.endsWith('/')),
    'Folders must be copied to folders',
  );
export type CopyInput = z.input<typeof copySchema>;

export const presignSchema = z.object({
  key: objectKeySchema,
  method: z.enum(['GET', 'PUT']),
  expiresIn: z.number().int().min(MIN_PRESIGN_SECONDS).max(MAX_PRESIGN_SECONDS),
  versionId: z.string().max(1024).optional(),
  contentType: z.string().max(255).optional(),
});
export type PresignInput = z.infer<typeof presignSchema>;

const headerValue = z
  .string()
  .max(2048)
  .regex(/^[^\r\n]*$/, 'No line breaks');
const metaKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9-_]+$/, 'Letters, digits, "-" and "_" only');

export const metadataSchema = z.object({
  keys: z.array(objectKeySchema).min(1).max(1000),
  /** Only the fields present are changed. Empty string clears the header. */
  contentType: headerValue.optional(),
  cacheControl: headerValue.optional(),
  contentDisposition: headerValue.optional(),
  contentEncoding: headerValue.optional(),
  /** When present, replaces all x-amz-meta-* fields. */
  metadata: z.record(metaKey, headerValue).optional(),
});
export type MetadataInput = z.infer<typeof metadataSchema>;

export const tagSchema = z.object({
  Key: z.string().min(1).max(128),
  Value: z.string().max(256),
});
export const tagsSchema = z.object({
  keys: z.array(objectKeySchema).min(1).max(1000),
  versionId: z.string().max(1024).optional(),
  tags: z
    .array(tagSchema)
    .max(MAX_TAGS, `At most ${MAX_TAGS} tags`)
    .refine((t) => new Set(t.map((x) => x.Key)).size === t.length, 'Tag keys must be unique'),
});
export type TagsInput = z.infer<typeof tagsSchema>;

export const versionActionSchema = z.object({
  key: objectKeySchema,
  versionId: z.string().min(1).max(1024),
});

export const zipSchema = z.object({
  /** Folder the selection lives in; ZIP entry names are relative to it. */
  base: prefixSchema.default(''),
  keys: z.array(objectKeySchema).max(100_000).default([]),
  prefixes: z.array(prefixSchema).max(1000).default([]),
  name: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------ */
/* Buckets                                                             */
/* ------------------------------------------------------------------ */

export const createBucketSchema = z.object({
  name: newBucketNameSchema,
  region: regionSchema.optional(),
});
export type CreateBucketInput = z.infer<typeof createBucketSchema>;

export const deleteBucketQuerySchema = z.object({
  force: z.enum(['0', '1']).default('0'),
});

export const versioningSchema = z.object({ enabled: z.boolean() });

const httpMethod = z.enum(['GET', 'PUT', 'POST', 'DELETE', 'HEAD']);
export const corsRuleSchema = z.strictObject({
  ID: z.string().max(255).optional(),
  AllowedOrigins: z.array(z.string().min(1)).min(1, 'AllowedOrigins needs at least one origin'),
  AllowedMethods: z.array(httpMethod).min(1, 'AllowedMethods needs at least one method'),
  AllowedHeaders: z.array(z.string()).optional(),
  ExposeHeaders: z.array(z.string()).optional(),
  MaxAgeSeconds: z.number().int().min(0).optional(),
});
export const corsSchema = z.array(corsRuleSchema).max(100);

const lifecycleFilter = z.looseObject({
  Prefix: z.string().optional(),
  Tag: tagSchema.optional(),
  ObjectSizeGreaterThan: z.number().int().min(0).optional(),
  ObjectSizeLessThan: z.number().int().min(0).optional(),
  And: z.looseObject({}).optional(),
});
export const lifecycleRuleSchema = z.looseObject({
  ID: z.string().max(255).optional(),
  Status: z.enum(['Enabled', 'Disabled']),
  Filter: lifecycleFilter.optional(),
  Prefix: z.string().optional(),
  Expiration: z.looseObject({ Days: z.number().int().min(1).optional(), Date: z.string().optional() }).optional(),
  Transitions: z.array(z.looseObject({ StorageClass: z.string() })).optional(),
  NoncurrentVersionExpiration: z.looseObject({ NoncurrentDays: z.number().int().min(1).optional() }).optional(),
  AbortIncompleteMultipartUpload: z.looseObject({ DaysAfterInitiation: z.number().int().min(1) }).optional(),
});
export const lifecycleSchema = z.array(lifecycleRuleSchema).max(1000);

export const policySchema = z
  .looseObject({
    Version: z.string().optional(),
    Statement: z
      .array(z.looseObject({ Effect: z.enum(['Allow', 'Deny']) }))
      .min(1, 'A policy needs at least one statement'),
  })
  .nullable();

export const publicAccessBlockSchema = z.strictObject({
  BlockPublicAcls: z.boolean(),
  IgnorePublicAcls: z.boolean(),
  BlockPublicPolicy: z.boolean(),
  RestrictPublicBuckets: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const roleSchema = z.enum(['viewer', 'editor', 'admin']);

export const usernameSchema = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(128)
  .regex(/^[A-Za-z0-9._@+-]+$/, 'Letters, digits and . _ @ + - only');

export const passwordSchema = z.string().min(10, 'At least 10 characters').max(256);

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema.optional(),
  role: roleSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ role: roleSchema.optional(), disabled: z.boolean().optional(), password: passwordSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const activityQuerySchema = z.object({
  user: z.string().max(128).optional(),
  bucket: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(200),
});

/* ------------------------------------------------------------------ */
/* Resumable (client-driven multipart) uploads                         */
/* ------------------------------------------------------------------ */

export const MAX_PART_BYTES = 128 * 1024 * 1024;

export const multipartCreateSchema = z.object({
  key: objectKeySchema.refine((k) => !k.endsWith('/'), 'File keys must not end with "/"'),
  contentType: z.string().max(255).optional(),
});

export const multipartRefSchema = z.object({
  key: objectKeySchema,
  uploadId: z.string().min(1).max(1024),
});

export const multipartPartQuerySchema = multipartRefSchema.extend({
  partNumber: z.coerce.number().int().min(1).max(10_000),
});

export const multipartCompleteSchema = multipartRefSchema.extend({
  parts: z
    .array(z.object({ PartNumber: z.number().int().min(1).max(10_000), ETag: z.string().min(1).max(256) }))
    .min(1)
    .max(10_000),
});

/* ------------------------------------------------------------------ */
/* Storage classes & archive restore                                   */
/* ------------------------------------------------------------------ */

export const storageClassSchema = z.object({
  keys: z.array(objectKeySchema).min(1).max(1000),
  storageClass: z
    .string()
    .regex(/^[A-Z_]+$/, 'Unknown storage class')
    .max(64),
});

export const restoreArchiveSchema = z.object({
  keys: z.array(objectKeySchema).min(1).max(1000),
  days: z.number().int().min(1).max(365),
  tier: z.enum(['Expedited', 'Standard', 'Bulk']),
});

export const deletedQuerySchema = z.object({
  prefix: prefixSchema.default(''),
  cursor: z.string().max(4096).optional(),
});

/* ------------------------------------------------------------------ */
/* Compare & sync                                                      */
/* ------------------------------------------------------------------ */

export const locationSchema = z.object({
  connectionId: z.string().min(1).max(128),
  bucket: bucketParamSchema,
  prefix: prefixSchema.default(''),
});

export const compareSchema = z.object({
  source: locationSchema,
  target: locationSchema,
});

export const syncSchema = compareSchema.extend({
  /** "copy": copy missing and changed objects. "mirror": also delete objects only in the target. */
  mode: z.enum(['copy', 'mirror']),
});
export type SyncInput = z.input<typeof syncSchema>;

/** Turns a zod error into a short, readable message. */
export function formatZodError(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}
