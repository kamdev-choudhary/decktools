/**
 * Every deck the site features. Add a deck here, then give it a folder:
 *
 *   src/decks/<slug>/components/   its landing page sections
 *   src/decks/<slug>/assets/       its screenshots
 *   src/pages/<slug>/index.astro   its page, at /<slug>/
 *
 * Planned decks appear on the home page as "in the works" until they ship.
 */
export interface Deck {
  slug: string;
  name: string;
  /** What it's a UI for, e.g. "PostgreSQL". */
  target: string;
  tagline: string;
  /** Example command shown on the home page card. */
  command: string;
  status: 'available' | 'planned';
  /** True once src/pages/<slug>/ exists; until then the card links to the deck's README. */
  hasPage?: boolean;
  /** Shown while no version can be fetched from npm. */
  fallbackVersion?: string;
  /** Screenshot shown on the home page card: src/decks/<slug>/assets/shots/<preview>-{dark,light}.png. */
  preview?: { shot: string; alt: string };
}

export const DECKS: Deck[] = [
  {
    slug: 'pgdeck',
    name: 'pgdeck',
    target: 'PostgreSQL',
    tagline: 'Browse and edit rows, run SQL, change tables and watch live activity on every database on your server.',
    command: 'npx pgdeck postgres://localhost:5432',
    status: 'available',
    hasPage: true,
    fallbackVersion: '0.1.5',
    preview: { shot: 'overview', alt: 'The pgdeck overview with live transaction charts and active sessions.' },
  },
  {
    slug: 's3deck',
    name: 's3deck',
    target: 'S3 storage',
    tagline: 'Browse buckets, preview files, move gigabytes, share links and manage bucket settings on AWS S3, Cloudflare R2, MinIO, Backblaze B2 and more.',
    command: 'npx s3deck --profile prod --open',
    status: 'available',
    fallbackVersion: '0.1.1',
  },
  {
    slug: 'redisdeck',
    name: 'redisdeck',
    target: 'Redis',
    tagline: 'Explore keys, inspect values of every type, and watch memory and command stats live.',
    command: 'npx redisdeck redis://localhost:6379',
    status: 'planned',
  },
  {
    slug: 'webhookdeck',
    name: 'webhookdeck',
    target: 'Webhooks',
    tagline: 'Catch, inspect and replay webhook deliveries against your local server.',
    command: 'npx webhookdeck',
    status: 'planned',
  },
];

export const deck = (slug: string): Deck => {
  const d = DECKS.find((x) => x.slug === slug);
  if (!d) throw new Error(`Unknown deck: ${slug}`);
  return d;
};
