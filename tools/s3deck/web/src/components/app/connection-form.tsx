import { zodResolver } from '@hookform/resolvers/zod';
import { connectionInputSchema, pathStyleSchema, type ConnectionInput } from '@shared/schemas';
import { ChevronRight, CircleAlert, KeyRound, Lock } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorText } from '@/api/client';
import { useAddConnection, useMe } from '@/api/hooks';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FormField } from './form-field';

/**
 * Endpoint templates. A <placeholder> part is pre-selected on focus so pasting replaces just that;
 * `regionFrom` pulls the region out of a filled-in endpoint.
 */
const PROVIDERS: Record<
  string,
  { name: string; endpoint: string; endpointHint: string; region: string; regionHint: string; regionFrom?: RegExp }
> = {
  aws: { name: 'AWS S3', endpoint: '', endpointHint: 'Leave empty for AWS', region: 'us-east-1', regionHint: 'e.g. eu-west-2' },
  r2: {
    name: 'Cloudflare R2',
    endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    endpointHint: 'Replace <account-id> with your ID from Cloudflare dashboard → R2',
    region: 'auto',
    regionHint: 'R2 uses "auto"',
  },
  minio: {
    name: 'MinIO',
    endpoint: 'http://<host>:9000',
    endpointHint: 'Replace <host> with your server, e.g. localhost',
    region: 'us-east-1',
    regionHint: 'Usually us-east-1',
  },
  b2: {
    name: 'Backblaze B2',
    endpoint: 'https://s3.<region>.backblazeb2.com',
    endpointHint: 'Replace <region> with your bucket’s region, e.g. us-west-004',
    region: '',
    regionHint: 'Filled from the endpoint',
    regionFrom: /^https?:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com/i,
  },
  spaces: {
    name: 'DigitalOcean Spaces',
    endpoint: 'https://<region>.digitaloceanspaces.com',
    endpointHint: 'Replace <region> with your datacenter, e.g. nyc3',
    region: '',
    regionHint: 'Filled from the endpoint',
    regionFrom: /^https?:\/\/([a-z0-9-]+)\.digitaloceanspaces\.com/i,
  },
  wasabi: {
    name: 'Wasabi',
    endpoint: 'https://s3.<region>.wasabisys.com',
    endpointHint: 'Replace <region> with your region, e.g. eu-central-1',
    region: '',
    regionHint: 'Filled from the endpoint',
    regionFrom: /^https?:\/\/s3\.([a-z0-9-]+)\.wasabisys\.com/i,
  },
  other: {
    name: 'Other S3-compatible',
    endpoint: 'https://<host>',
    endpointHint: 'Replace <host> with your gateway (Ceph, Garage, LocalStack, SeaweedFS…)',
    region: 'us-east-1',
    regionHint: '',
  },
};
type ProviderKey = 'aws' | 'r2' | 'minio' | 'b2' | 'spaces' | 'wasabi' | 'other';
const PROVIDER_KEYS = Object.keys(PROVIDERS) as [ProviderKey, ...ProviderKey[]];

/** The form keeps plain strings; they're converted to ConnectionInput and validated again on submit. */
const formSchema = z
  .object({
    provider: z.enum(PROVIDER_KEYS),
    label: connectionInputSchema.shape.label.unwrap(),
    endpoint: z.string().trim(),
    region: z.string().trim(),
    accessKeyId: connectionInputSchema.shape.accessKeyId,
    secretAccessKey: connectionInputSchema.shape.secretAccessKey,
    sessionToken: z.string().trim().max(8192),
    pathStyle: pathStyleSchema,
    buckets: z.string(),
    publicUrlBase: z.string().trim(),
    remember: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.provider !== 'aws' && !v.endpoint) {
      ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'Endpoint is required for this provider' });
    }
    if (v.endpoint.includes('<')) {
      ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'Replace the placeholder with your own value' });
    }
  });
type FormValues = z.infer<typeof formSchema>;

function toInput(v: FormValues): ConnectionInput {
  return {
    label: v.label || undefined,
    endpoint: v.endpoint || undefined,
    region: v.region || undefined,
    accessKeyId: v.accessKeyId,
    secretAccessKey: v.secretAccessKey,
    sessionToken: v.sessionToken || undefined,
    pathStyle: v.pathStyle,
    buckets: v.buckets
      .split(/[\s,]+/)
      .map((b) => b.trim())
      .filter(Boolean),
    publicUrlBase: v.publicUrlBase || undefined,
    remember: v.remember || undefined,
  };
}

export function ConnectionForm({ onConnected, onCancel }: { onConnected?: () => void; onCancel?: () => void }) {
  const add = useAddConnection();
  const me = useMe();
  const canRemember = !!me.data?.persistence;
  const [advanced, setAdvanced] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: 'aws',
      label: '',
      endpoint: '',
      region: 'us-east-1',
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: '',
      pathStyle: 'auto',
      buckets: '',
      publicUrlBase: '',
      remember: false,
    },
  });
  const { errors } = form.formState;
  const provider = PROVIDERS[form.watch('provider')]!;

  const onSubmit = form.handleSubmit((values) => {
    const parsed = connectionInputSchema.safeParse(toInput(values));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        form.setError((issue.path[0] as keyof FormValues) ?? 'root', { message: issue.message });
      }
      return;
    }
    add.mutate(parsed.data, {
      onSuccess: (data) => {
        // Don't keep the secret in the page any longer than needed.
        form.reset({ ...form.getValues(), secretAccessKey: '', sessionToken: '' });
        const count = data.bucketCount;
        toast.success('Connected', {
          description: count === null ? 'Opened your configured buckets.' : `${count} bucket${count === 1 ? '' : 's'} available.`,
        });
        onConnected?.();
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate autoComplete="off">
      <FieldGroup className="gap-4">
        <FormField label="Provider" htmlFor="provider">
          <Controller
            control={form.control}
            name="provider"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v: ProviderKey) => {
                  field.onChange(v);
                  form.setValue('region', PROVIDERS[v]!.region);
                  form.setValue('endpoint', PROVIDERS[v]!.endpoint);
                  form.clearErrors('endpoint');
                }}
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROVIDERS).map(([k, p]) => (
                    <SelectItem key={k} value={k}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
          <FormField label="Endpoint" htmlFor="endpoint" description={provider.endpointHint} error={errors.endpoint?.message}>
            <Input
              id="endpoint"
              placeholder={provider.endpoint || 'https://s3.amazonaws.com'}
              spellCheck={false}
              aria-invalid={!!errors.endpoint}
              {...form.register('endpoint', {
                onChange: (e: { target: { value: string } }) => {
                  const region = provider.regionFrom && e.target.value.match(provider.regionFrom)?.[1];
                  if (region && !region.includes('<')) form.setValue('region', region.toLowerCase());
                },
              })}
              onFocus={(e) => {
                // Select a <placeholder> part (e.g. <account-id>) so pasting replaces just that.
                const el = e.currentTarget;
                const start = el.value.indexOf('<');
                const end = el.value.indexOf('>', start);
                if (start !== -1 && end !== -1) requestAnimationFrame(() => el.setSelectionRange(start, end + 1));
              }}
            />
          </FormField>
          <FormField label="Region" htmlFor="region" description={provider.regionHint} error={errors.region?.message}>
            <Input id="region" placeholder="us-east-1" aria-invalid={!!errors.region} {...form.register('region')} />
          </FormField>
        </div>

        <FormField label="Access key ID" htmlFor="accessKeyId" error={errors.accessKeyId?.message}>
          <Input id="accessKeyId" spellCheck={false} autoComplete="off" className="font-mono" aria-invalid={!!errors.accessKeyId} {...form.register('accessKeyId')} />
        </FormField>
        <FormField label="Secret access key" htmlFor="secretAccessKey" error={errors.secretAccessKey?.message}>
          <Input
            id="secretAccessKey"
            type="password"
            spellCheck={false}
            autoComplete="new-password"
            className="font-mono"
            aria-invalid={!!errors.secretAccessKey}
            {...form.register('secretAccessKey')}
          />
        </FormField>

        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <ChevronRight className={cn('transition-transform', advanced && 'rotate-90')} />
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldGroup className="mt-2 gap-4 rounded-lg border bg-muted/30 p-4">
              <FormField label="Name" htmlFor="label" description="Shown in the connection switcher" error={errors.label?.message}>
                <Input id="label" placeholder={`${provider.name} (prod)`} {...form.register('label')} />
              </FormField>
              <FormField label="Session token" htmlFor="sessionToken" description="Only for temporary (STS) credentials" error={errors.sessionToken?.message}>
                <Textarea id="sessionToken" rows={2} className="font-mono text-xs" spellCheck={false} {...form.register('sessionToken')} />
              </FormField>
              <FormField label="URL style" htmlFor="pathStyle" description="Auto picks path-style for MinIO and unknown endpoints">
                <Controller
                  control={form.control}
                  name="pathStyle"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="pathStyle" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="path">Path-style (host/bucket/key)</SelectItem>
                        <SelectItem value="virtual">Virtual-hosted (bucket.host/key)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField
                label="Buckets"
                htmlFor="buckets"
                description="For keys that can't list buckets: bucket names to open, separated by commas or spaces"
                error={errors.buckets?.message}
              >
                <Input id="buckets" placeholder="my-app-uploads, logs" {...form.register('buckets')} />
              </FormField>
              <FormField label="Public URL base" htmlFor="publicUrlBase" description="Custom domain for public objects" error={errors.publicUrlBase?.message}>
                <Input id="publicUrlBase" placeholder="https://cdn.example.com" {...form.register('publicUrlBase')} />
              </FormField>
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>

        {canRemember && (
          <Field orientation="horizontal">
            <Controller
              control={form.control}
              name="remember"
              render={({ field }) => <Checkbox id="remember" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />}
            />
            <FieldContent>
              <FieldLabel htmlFor="remember">Remember this connection</FieldLabel>
              <FieldDescription>Saved encrypted on the s3deck server, so it’s still here after a restart. Only you can use it.</FieldDescription>
            </FieldContent>
          </Field>
        )}

        {add.isError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{errorText(add.error)}</AlertDescription>
          </Alert>
        )}

        <FieldDescription className="flex items-start gap-2">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          {form.watch('remember')
            ? 'Keys are sent once to the s3deck server and stored there encrypted (AES-256-GCM). They are never sent back to the browser.'
            : 'Keys are sent once to the s3deck server and kept in its memory for this session. They are never sent back to the browser or written to disk, and are forgotten when you log out or s3deck restarts.'}
        </FieldDescription>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? <Spinner /> : <KeyRound />}
            Connect
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
