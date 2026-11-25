import { Command, Option } from 'commander';
import { z } from 'zod';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_USER } from '../shared/constants';
import { bucketParamSchema, formatZodError, regionSchema } from '../shared/schemas';

const optionsSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .refine((v) => {
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    }, 'endpoint must be an http(s) URL, e.g. http://localhost:9000')
    .optional(),
  port: z.coerce.number().int().min(0).max(65535),
  host: z.string().trim().min(1),
  user: z.string().trim().min(1).max(128),
  password: z.string().min(8, 'password must be at least 8 characters').max(256).optional(),
  auth: z.boolean(),
  region: regionSchema.optional(),
  profile: z.string().trim().min(1).optional(),
  accessKey: z.string().trim().min(1).optional(),
  secretKey: z.string().min(1).optional(),
  sessionToken: z.string().min(1).optional(),
  pathStyle: z.boolean().optional(),
  bucket: z.array(bucketParamSchema).default([]),
  readonly: z.boolean().default(false),
  basePath: z
    .string()
    .trim()
    .regex(/^\/?[\w\-./~]*$/, 'base path may only contain URL path characters')
    .transform((v) => {
      const trimmed = v.replace(/^\/+|\/+$/g, '');
      return trimmed ? `/${trimmed}` : '';
    })
    .default(''),
  open: z.boolean().default(false),
  browserConnections: z.boolean().default(true),
  dataDir: z.string().trim().min(1).optional(),
  persist: z.boolean().default(true),
  publicUrl: z
    .string()
    .trim()
    .refine((v) => {
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    }, 'public URL must be an http(s) URL')
    .optional(),
  dev: z.boolean().default(false),
});

export type CliOptions = z.infer<typeof optionsSchema>;

const collect = (value: string, previous: string[] = []) => [...previous, value];

export function buildProgram(version: string) {
  return new Command()
    .name('s3deck')
    .description('A fast, modern web UI for S3 and S3-compatible storage.')
    .argument('[endpoint]', 'S3 endpoint URL. Leave out for AWS S3')
    .addOption(new Option('-p, --port <port>', 'port for the web UI').env('PORT').default(String(DEFAULT_PORT)))
    .addOption(new Option('-H, --host <host>', 'interface to bind (0.0.0.0 for containers/LAN)').default(DEFAULT_HOST))
    .addOption(new Option('-u, --user <name>', 'login username').default(DEFAULT_USER))
    .addOption(new Option('-P, --password <password>', 'login password (random if not set)').env('S3DECK_PASSWORD'))
    .option('--no-auth', 'disable the login page (trusted machines only)')
    .addOption(new Option('--region <region>', 'region to sign requests for').env('AWS_REGION'))
    .addOption(new Option('--profile <name>', 'AWS profile to use').env('AWS_PROFILE'))
    .option('--access-key <id>', 'access key ID (prefer AWS_ACCESS_KEY_ID)')
    .option('--secret-key <secret>', 'secret access key (prefer AWS_SECRET_ACCESS_KEY)')
    .option('--session-token <token>', 'session token for temporary credentials')
    .option('--path-style', 'use path-style URLs (host/bucket/key)')
    .option('--bucket <name>', 'open this bucket directly; repeat for several', collect)
    .option('--readonly', 'disable uploads, edits and deletes')
    .option('--base-path <path>', 'serve under a path prefix such as /s3')
    .option('--open', 'open the UI in your browser')
    .option('--no-browser-connections', "don't let users enter credentials in the browser")
    .addOption(
      new Option('--data-dir <dir>', 'where users, remembered connections and the activity log are kept').env(
        'S3DECK_DATA_DIR',
      ),
    )
    .option('--no-persist', "don't write anything to disk (no users, remembered connections or activity file)")
    .addOption(
      new Option('--public-url <url>', 'public URL of this s3deck, for single sign-on redirects').env(
        'S3DECK_PUBLIC_URL',
      ),
    )
    .addOption(new Option('--dev', 'development mode (UI served by Vite)').hideHelp())
    .version(version, '-v, --version', 'print the version')
    .helpOption('-h, --help', 'show help')
    .showHelpAfterError('(run s3deck --help for usage)');
}

export function parseOptions(program: Command): CliOptions {
  const raw = program.opts();
  const endpoint =
    (program.args[0] as string | undefined) ?? process.env.AWS_ENDPOINT_URL_S3 ?? process.env.AWS_ENDPOINT_URL;
  const result = optionsSchema.safeParse({ ...raw, endpoint: endpoint || undefined });
  if (!result.success) program.error(`error: ${formatZodError(result.error)}`, { exitCode: 2 });
  return result.data;
}
