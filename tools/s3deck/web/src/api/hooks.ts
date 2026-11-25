import type {
  ConnectionInput,
  CopyInput,
  CreateBucketInput,
  CreateUserInput,
  SyncInput,
  UpdateUserInput,
  DeleteInput,
  LoginInput,
  MetadataInput,
  PresignInput,
  TagsInput,
} from '@shared/schemas';
import type {
  ActivityEntry,
  CompareResult,
  DeletedListResponse,
  JobInfo,
  MultipartUploadInfo,
  UserInfo,
  BucketSettings,
  BucketsResponse,
  ConnectionsResponse,
  CopyResponse,
  DeleteResponse,
  ListResponse,
  MeResponse,
  ObjectDetails,
  PresignResponse,
  SummaryResponse,
  Tag,
  UsageResponse,
  VersionEntry,
} from '@shared/types';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, bucketPath } from './client';

/** Query keys. Everything storage-related sits under ["s3", connectionId] so switching connections is clean. */
export const qk = {
  me: ['me'] as const,
  connections: ['connections'] as const,
  s3: ['s3'] as const,
  buckets: () => ['s3', 'buckets'] as const,
  bucket: (b: string) => ['s3', 'bucket', b] as const,
  objects: (b: string, prefix: string, flat: boolean) => ['s3', 'bucket', b, 'objects', prefix, flat] as const,
  details: (b: string, key: string, versionId?: string | null) =>
    ['s3', 'bucket', b, 'details', key, versionId ?? null] as const,
  versions: (b: string, key: string) => ['s3', 'bucket', b, 'versions', key] as const,
  tags: (b: string, key: string) => ['s3', 'bucket', b, 'tags', key] as const,
  settings: (b: string) => ['s3', 'bucket', b, 'settings'] as const,
  usage: (b: string, prefix: string) => ['s3', 'bucket', b, 'usage', prefix] as const,
  deleted: (b: string, prefix: string) => ['s3', 'bucket', b, 'deleted', prefix] as const,
  incomplete: (b: string) => ['s3', 'bucket', b, 'incomplete'] as const,
  folderSize: (b: string, prefix: string) => ['s3', 'bucket', b, 'folder-size', prefix] as const,
  users: ['admin', 'users'] as const,
  activity: (filter: object) => ['admin', 'activity', filter] as const,
  jobs: ['jobs'] as const,
};

export function invalidateBucket(qc: QueryClient, bucket: string) {
  return qc.invalidateQueries({ queryKey: qk.bucket(bucket) });
}

/* ---------------------------------- auth ---------------------------------- */

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api<MeResponse>('auth/me'), staleTime: 60_000 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api('auth/login', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

/* ------------------------------- connections ------------------------------ */

export function useConnections(enabled = true) {
  return useQuery({ queryKey: qk.connections, queryFn: () => api<ConnectionsResponse>('connections'), enabled });
}

function onConnectionChange(qc: QueryClient, data: ConnectionsResponse) {
  qc.setQueryData(qk.connections, data);
  qc.removeQueries({ queryKey: qk.s3 });
}

export function useAddConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectionInput) =>
      api<ConnectionsResponse & { bucketCount: number | null }>('connections', { method: 'POST', body: input }),
    onSuccess: (data) => onConnectionChange(qc, data),
  });
}

export function useActivateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<ConnectionsResponse>(`connections/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
    onSuccess: (data) => onConnectionChange(qc, data),
  });
}

export function useRemoveConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ConnectionsResponse>(`connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (data) => onConnectionChange(qc, data),
  });
}

/* --------------------------------- buckets -------------------------------- */

export function useBuckets(enabled = true) {
  return useQuery({ queryKey: qk.buckets(), queryFn: () => api<BucketsResponse>('buckets'), enabled, retry: false });
}

export function useCreateBucket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBucketInput) => api('buckets', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.buckets() }),
  });
}

export function useDeleteBucket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, force }: { bucket: string; force: boolean }) =>
      api(bucketPath(bucket), { method: 'DELETE', query: { force: force ? '1' : '0' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.buckets() }),
  });
}

export function useBucketSettings(bucket: string) {
  return useQuery({
    queryKey: qk.settings(bucket),
    queryFn: () => api<BucketSettings>(bucketPath(bucket, '/settings')),
  });
}

export function useSaveSetting(bucket: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      setting,
      body,
    }: {
      setting: 'versioning' | 'cors' | 'lifecycle' | 'policy' | 'public-access';
      body: unknown;
    }) => api(bucketPath(bucket, `/settings/${setting}`), { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings(bucket) }),
  });
}

export function useUsage(bucket: string, prefix: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.usage(bucket, prefix),
    queryFn: ({ signal }) => api<UsageResponse>(bucketPath(bucket, '/usage'), { query: { prefix }, signal }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

/* --------------------------------- objects -------------------------------- */

export function useObjects(bucket: string, prefix: string, flat: boolean) {
  return useInfiniteQuery({
    queryKey: qk.objects(bucket, prefix, flat),
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse>(bucketPath(bucket, '/objects'), {
        query: { prefix, cursor: pageParam, flat: flat ? '1' : '0', limit: 500 },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useObjectDetails(bucket: string, key: string | null, versionId?: string | null) {
  return useQuery({
    queryKey: qk.details(bucket, key ?? '', versionId),
    queryFn: () =>
      api<ObjectDetails>(bucketPath(bucket, '/details'), {
        query: { key: key ?? '', versionId: versionId ?? undefined },
      }),
    enabled: !!key,
  });
}

export function useVersions(bucket: string, key: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.versions(bucket, key),
    queryFn: () => api<{ versions: VersionEntry[] }>(bucketPath(bucket, '/versions'), { query: { key } }),
    enabled,
  });
}

export function useTags(bucket: string, key: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.tags(bucket, key),
    queryFn: () => api<{ tags: Tag[] }>(bucketPath(bucket, '/tags'), { query: { key } }),
    enabled,
    retry: false,
  });
}

export function useBucketMutation<TInput, TOutput = unknown>(
  bucket: string,
  fn: (input: TInput) => Promise<TOutput>,
  extraInvalidate?: (input: TInput) => string[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: (_d, _e, input) => {
      void invalidateBucket(qc, bucket);
      for (const b of extraInvalidate?.(input) ?? []) void invalidateBucket(qc, b);
    },
  });
}

export const objectApi = {
  delete: (bucket: string, input: DeleteInput) =>
    api<DeleteResponse>(bucketPath(bucket, '/delete'), { method: 'POST', body: input }),
  summary: (bucket: string, input: { keys?: string[]; prefixes: string[] }, signal?: AbortSignal) =>
    api<SummaryResponse>(bucketPath(bucket, '/summary'), { method: 'POST', body: input, signal }),
  copy: (bucket: string, input: CopyInput) =>
    api<CopyResponse>(bucketPath(bucket, '/copy'), { method: 'POST', body: input }),
  createFolder: (bucket: string, prefix: string) =>
    api(bucketPath(bucket, '/folder'), { method: 'POST', body: { prefix } }),
  presign: (bucket: string, input: PresignInput) =>
    api<PresignResponse>(bucketPath(bucket, '/presign'), { method: 'POST', body: input }),
  metadata: (bucket: string, input: MetadataInput) =>
    api(bucketPath(bucket, '/metadata'), { method: 'POST', body: input }),
  tags: (bucket: string, input: TagsInput) => api(bucketPath(bucket, '/tags'), { method: 'PUT', body: input }),
  restoreVersion: (bucket: string, key: string, versionId: string) =>
    api(bucketPath(bucket, '/versions/restore'), { method: 'POST', body: { key, versionId } }),
  deleteVersion: (bucket: string, key: string, versionId: string) =>
    api(bucketPath(bucket, '/versions/delete'), { method: 'POST', body: { key, versionId } }),
  zip: (bucket: string, input: { base: string; keys: string[]; prefixes: string[] }) =>
    api<{ token: string }>(bucketPath(bucket, '/zip'), { method: 'POST', body: input }),
};

/* --------------------------- deleted & incomplete --------------------------- */

export function useDeleted(bucket: string, prefix: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.deleted(bucket, prefix),
    queryFn: ({ pageParam, signal }) =>
      api<DeletedListResponse>(bucketPath(bucket, '/deleted'), { query: { prefix, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function useIncompleteUploads(bucket: string, enabled = true) {
  return useQuery({
    queryKey: qk.incomplete(bucket),
    queryFn: () => api<{ uploads: MultipartUploadInfo[] }>(bucketPath(bucket, '/multipart')),
    enabled,
    retry: false,
  });
}

/** Size of one folder, calculated on demand. */
export function useFolderSize(bucket: string, prefix: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.folderSize(bucket, prefix),
    queryFn: ({ signal }) => objectApi.summary(bucket, { prefixes: [prefix] }, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export const moreObjectApi = {
  abortUpload: (bucket: string, key: string, uploadId: string) =>
    api(bucketPath(bucket, '/multipart/abort'), { method: 'POST', body: { key, uploadId } }),
  storageClass: (bucket: string, keys: string[], storageClass: string) =>
    api<{ updated: number }>(bucketPath(bucket, '/storage-class'), { method: 'POST', body: { keys, storageClass } }),
  restoreArchive: (bucket: string, keys: string[], days: number, tier: 'Expedited' | 'Standard' | 'Bulk') =>
    api<{ requested: number }>(bucketPath(bucket, '/restore-archive'), { method: 'POST', body: { keys, days, tier } }),
};

/* ---------------------------------- admin ---------------------------------- */

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => api<{ users: UserInfo[]; startupAdmin: string }>('admin/users'),
    enabled,
  });
}

export function useUserMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: qk.users });
  return {
    create: useMutation({
      mutationFn: (input: CreateUserInput) => api<UserInfo>('admin/users', { method: 'POST', body: input }),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ username, patch }: { username: string; patch: UpdateUserInput }) =>
        api<UserInfo>(`admin/users/${encodeURIComponent(username)}`, { method: 'PATCH', body: patch }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (username: string) => api(`admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
      onSuccess: done,
    }),
  };
}

export function useActivity(filter: { user?: string; bucket?: string; limit?: number }) {
  return useQuery({
    queryKey: qk.activity(filter),
    queryFn: () => api<{ entries: ActivityEntry[]; persisted: boolean }>('admin/activity', { query: filter }),
    refetchInterval: 15_000,
  });
}

/* ------------------------------- sync & jobs ------------------------------- */

export function useJobs() {
  return useQuery({
    queryKey: qk.jobs,
    queryFn: () => api<{ jobs: JobInfo[] }>('jobs'),
    // Poll quickly while something runs.
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === 'running') ? 1000 : 10_000),
  });
}

export const syncApi = {
  compare: (input: Omit<SyncInput, 'mode'>, signal?: AbortSignal) =>
    api<CompareResult>('sync/compare', { method: 'POST', body: input, signal }),
  start: (input: SyncInput) => api<JobInfo>('sync', { method: 'POST', body: input }),
  cancel: (id: string) => api(`jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Buckets of any connection (for choosing sync locations). */
export function useBucketsFor(connectionId: string | null) {
  return useQuery({
    queryKey: ['s3', 'buckets-for', connectionId],
    queryFn: () => api<BucketsResponse>('buckets', { headers: { 'x-s3deck-connection': connectionId! } }),
    enabled: !!connectionId,
    retry: false,
  });
}
