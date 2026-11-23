import { v4, v7, validate, version } from 'uuid';

/** UUID generation that matches the version a column already uses. */

export type UuidVersion = 4 | 7;

/**
 * Which version to generate for a column: the existing value's, else what the
 * column default produces, else v7 (time-ordered, index-friendly).
 */
export function preferredUuidVersion(value: string, columnDefault: string | null): UuidVersion {
  const v = validate(value.trim()) ? version(value.trim()) : null;
  if (v === 4 || v === 7) return v;
  const d = (columnDefault ?? '').toLowerCase();
  if (/gen_random_uuid|uuid_generate_v4/.test(d)) return 4;
  return 7;
}

export const generateUuid = (ver: UuidVersion): string => (ver === 7 ? v7() : v4());
