import { Hono } from 'hono';
import {
  createBucket,
  deleteBucket,
  getBucketSettings,
  listBuckets,
  setCors,
  setLifecycle,
  setPolicy,
  setPublicAccessBlock,
  setVersioning,
} from '../../s3/buckets';
import { isAccessDenied } from '../../s3/errors';
import { calculateUsage } from '../../s3/usage';
import {
  bucketParamSchema,
  corsSchema,
  createBucketSchema,
  deleteBucketQuerySchema,
  lifecycleSchema,
  policySchema,
  prefixQuerySchema,
  publicAccessBlockSchema,
  versioningSchema,
} from '../../shared/schemas';
import type { BucketsResponse } from '../../shared/types';
import type { AuthedEnv, ServerContext } from '../context';
import { HttpError } from '../errors';
import { logActivity, writable } from '../middleware';
import { validate } from '../validate';
import { z } from 'zod';

const bucketParam = z.object({ bucket: bucketParamSchema });

export function bucketRoutes(ctx: ServerContext) {
  // Buckets and their settings are admin territory; objects are for editors.
  const write = writable(ctx, 'admin');

  const requireCapability = (enabled: boolean, what: string) => {
    if (!enabled) throw new HttpError(501, 'UNSUPPORTED', `${what} is not supported by this provider`);
  };

  return new Hono<AuthedEnv>()
    .get('/', async (c) => {
      const conn = c.get('conn');
      let body: BucketsResponse;
      try {
        const buckets = await listBuckets(conn.handle.client);
        // Pinned buckets the key can access but doesn't own still show up.
        const names = new Set(buckets.map((b) => b.name));
        for (const name of conn.pinnedBuckets) {
          if (!names.has(name)) buckets.push({ name, createdAt: null, region: null });
        }
        body = { buckets, fallback: false };
      } catch (err) {
        if (!isAccessDenied(err) || conn.pinnedBuckets.length === 0) throw err;
        body = { buckets: conn.pinnedBuckets.map((name) => ({ name, createdAt: null, region: null })), fallback: true };
      }
      return c.json(body);
    })

    .post('/', write, validate('json', createBucketSchema), async (c) => {
      const conn = c.get('conn');
      const { name, region } = c.req.valid('json');
      await createBucket(conn.handle.client, name, region, conn.region);
      logActivity(ctx, c, 'bucket.create', { bucket: name });
      return c.json({ ok: true }, 201);
    })

    .delete(
      '/:bucket',
      write,
      validate('param', bucketParam),
      validate('query', deleteBucketQuerySchema),
      async (c) => {
        const conn = c.get('conn');
        const { bucket } = c.req.valid('param');
        const { force } = c.req.valid('query');
        await deleteBucket(conn.handle.client, bucket, force === '1', conn.provider.capabilities);
        logActivity(ctx, c, force === '1' ? 'bucket.empty-and-delete' : 'bucket.delete', { bucket });
        return c.json({ ok: true });
      },
    )

    .get('/:bucket/settings', validate('param', bucketParam), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      return c.json(await getBucketSettings(conn.handle.client, bucket, conn.provider.capabilities));
    })

    .put(
      '/:bucket/settings/versioning',
      write,
      validate('param', bucketParam),
      validate('json', versioningSchema),
      async (c) => {
        const conn = c.get('conn');
        requireCapability(conn.provider.capabilities.versioning, 'Versioning');
        await setVersioning(conn.handle.client, c.req.valid('param').bucket, c.req.valid('json').enabled);
        logActivity(ctx, c, 'settings.versioning', {
          bucket: c.req.valid('param').bucket,
          detail: c.req.valid('json').enabled ? 'enabled' : 'suspended',
        });
        return c.json({ ok: true });
      },
    )

    .put(
      '/:bucket/settings/cors',
      write,
      validate('param', bucketParam),
      validate('json', z.object({ rules: corsSchema })),
      async (c) => {
        const conn = c.get('conn');
        requireCapability(conn.provider.capabilities.cors, 'CORS');
        await setCors(conn.handle.client, c.req.valid('param').bucket, c.req.valid('json').rules);
        logActivity(ctx, c, 'settings.cors', {
          bucket: c.req.valid('param').bucket,
          detail: `${c.req.valid('json').rules.length} rules`,
        });
        return c.json({ ok: true });
      },
    )

    .put(
      '/:bucket/settings/lifecycle',
      write,
      validate('param', bucketParam),
      validate('json', z.object({ rules: lifecycleSchema })),
      async (c) => {
        const conn = c.get('conn');
        requireCapability(conn.provider.capabilities.lifecycle, 'Lifecycle rules');
        await setLifecycle(conn.handle.client, c.req.valid('param').bucket, c.req.valid('json').rules);
        logActivity(ctx, c, 'settings.lifecycle', {
          bucket: c.req.valid('param').bucket,
          detail: `${c.req.valid('json').rules.length} rules`,
        });
        return c.json({ ok: true });
      },
    )

    .put(
      '/:bucket/settings/policy',
      write,
      validate('param', bucketParam),
      validate('json', z.object({ policy: policySchema })),
      async (c) => {
        const conn = c.get('conn');
        requireCapability(conn.provider.capabilities.bucketPolicy, 'Bucket policies');
        await setPolicy(conn.handle.client, c.req.valid('param').bucket, c.req.valid('json').policy);
        logActivity(ctx, c, 'settings.policy', {
          bucket: c.req.valid('param').bucket,
          detail: c.req.valid('json').policy ? 'updated' : 'removed',
        });
        return c.json({ ok: true });
      },
    )

    .put(
      '/:bucket/settings/public-access',
      write,
      validate('param', bucketParam),
      validate('json', z.object({ config: publicAccessBlockSchema.nullable() })),
      async (c) => {
        const conn = c.get('conn');
        requireCapability(conn.provider.capabilities.publicAccessBlock, 'Public access settings');
        await setPublicAccessBlock(conn.handle.client, c.req.valid('param').bucket, c.req.valid('json').config);
        logActivity(ctx, c, 'settings.public-access', { bucket: c.req.valid('param').bucket });
        return c.json({ ok: true });
      },
    )

    .get('/:bucket/usage', validate('param', bucketParam), validate('query', prefixQuerySchema), async (c) => {
      const conn = c.get('conn');
      const { bucket } = c.req.valid('param');
      const { prefix } = c.req.valid('query');
      return c.json(await calculateUsage(conn.handle.client, bucket, prefix, c.req.raw.signal));
    });
}
