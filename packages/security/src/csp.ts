/**
 * Content-Security-Policy for a deck's built UI: everything same-origin, no
 * inline scripts. Inline styles are allowed because editors such as
 * CodeMirror inject <style> tags. Pass overrides to replace a directive.
 */
export const DEFAULT_CSP_DIRECTIVES: Readonly<Record<string, string>> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data:",
  'connect-src': "'self'",
  'frame-ancestors': "'self'",
  'base-uri': "'none'",
};

export function contentSecurityPolicy(overrides: Record<string, string> = {}): string {
  return Object.entries({ ...DEFAULT_CSP_DIRECTIVES, ...overrides })
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
}
