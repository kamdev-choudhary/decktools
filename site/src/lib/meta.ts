/**
 * Facts fetched once at build time: GitHub stars and published npm versions.
 * Network failures fall back so the build never breaks.
 */
export const REPO = 'kamdev-choudhary/pgdeck';
export const REPO_URL = `https://github.com/${REPO}`;

/** Folder of a deck's docs (its README) in the monorepo. */
export const docsUrl = (slug: string) => `${REPO_URL}/tree/main/tools/${slug}#readme`;
export const npmUrl = (pkg: string) => `https://www.npmjs.com/package/${pkg}`;

async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

let stars: Promise<number | null> | null = null;
/** GitHub stars for the monorepo, or null when unavailable. */
export function getStars(): Promise<number | null> {
  stars ??= json(`https://api.github.com/repos/${REPO}`)
    .then((r) => (typeof r.stargazers_count === 'number' ? r.stargazers_count : null))
    .catch(() => null);
  return stars;
}

const versions = new Map<string, Promise<string>>();
/** Latest published version of an npm package, or `fallback`. */
export function getVersion(pkg: string, fallback: string): Promise<string> {
  if (!versions.has(pkg)) {
    versions.set(
      pkg,
      json(`https://registry.npmjs.org/${pkg}/latest`)
        .then((r) => (r.version ? String(r.version) : fallback))
        .catch(() => fallback),
    );
  }
  return versions.get(pkg)!;
}

export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
