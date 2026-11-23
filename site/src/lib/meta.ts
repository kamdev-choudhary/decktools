/**
 * Facts fetched once at build time: GitHub stars and the published npm
 * version. Network failures fall back so the build never breaks.
 */
export const REPO = 'kamdev-choudhary/pgdeck';
export const REPO_URL = `https://github.com/${REPO}`;
export const NPM_URL = 'https://www.npmjs.com/package/pgdeck';

interface Meta {
  stars: number | null;
  version: string;
}

let cached: Promise<Meta> | null = null;

async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export function getMeta(): Promise<Meta> {
  cached ??= (async () => {
    const [gh, npm] = await Promise.allSettled([json(`https://api.github.com/repos/${REPO}`), json('https://registry.npmjs.org/pgdeck/latest')]);
    return {
      stars: gh.status === 'fulfilled' && typeof gh.value.stargazers_count === 'number' ? gh.value.stargazers_count : null,
      version: npm.status === 'fulfilled' && npm.value.version ? npm.value.version : '0.1.2',
    };
  })();
  return cached;
}

export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
