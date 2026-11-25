/**
 * Content for the shared deck landing-page sections in this folder. A deck's
 * page (src/pages/<slug>/index.astro) passes its own copy into each section;
 * src/decks/<slug>/content.ts keeps that copy in one place.
 */

/** Wrap code in spans for the site's highlighting palette. Values are trusted, written by us. */
export const hl = {
  comment: (s: string) => `<span class="text-faint">${s}</span>`,
  keyword: (s: string) => `<span class="text-pink">${s}</span>`,
  flag: (s: string) => `<span class="text-blue">${s}</span>`,
  string: (s: string) => `<span class="text-green">${s}</span>`,
  secret: (s: string) => `<span class="text-amber">${s}</span>`,
};

export interface Screenshot {
  /** src/decks/<deck>/assets/shots/<name>-{dark,light}.png */
  name: string;
  alt: string;
}

export interface HeroContent {
  /** Text in the release pill next to the version. */
  release: string;
  title: string;
  lede: string;
  /** Copyable command under the lede. */
  command: string;
  /** Small print under the command. */
  footnote: string;
  /** The command typed in the hero terminal. */
  terminalCommand: string;
  /** Prompt directory shown in the terminal title. */
  terminalCwd: string;
  /** Lines the CLI prints, as highlighted HTML (leading spaces kept). A line starting a new group gets `gap`. */
  terminal: { html: string; gap?: boolean }[];
  /** What the fake browser address bar shows. */
  host: string;
  shot: Screenshot;
  stats: readonly (readonly [string, string])[];
}

export interface TourStop {
  id: string;
  shot: string;
  label: string;
  body: string;
  alt: string;
}

export interface DeployContent {
  title: string;
  lede: string;
  flags: readonly (readonly [string, string])[];
  snippets: { id: string; label: string; html: string }[];
  safety: readonly (readonly [string, string])[];
}

export interface Feature {
  icon: string;
  title: string;
  body: string;
}
