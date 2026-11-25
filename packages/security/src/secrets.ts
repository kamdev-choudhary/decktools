import crypto from 'node:crypto';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

/** Constant-time string comparison (hashing first equalizes lengths). */
export const safeEqual = (a: string, b: string): boolean => crypto.timingSafeEqual(sha256(a), sha256(b));

/** A random, URL-safe password: 9 bytes → 12 characters. */
export const generatePassword = (bytes = 9): string => crypto.randomBytes(bytes).toString('base64url');

/**
 * Hide the password in a connection string before printing it. Handles URLs
 * (scheme://user:pass@host) and keyword/value strings (password=...).
 */
export function redactCredentials(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '****';
    return url.toString();
  } catch {
    return connectionString.replace(/password=\S+/i, 'password=****');
  }
}
