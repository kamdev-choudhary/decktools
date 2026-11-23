// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Served from GitHub Pages at https://kamdev-choudhary.github.io/pgdeck/.
// Override with SITE_URL / BASE_PATH when using a custom domain.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://kamdev-choudhary.github.io',
  base: process.env.BASE_PATH ?? '/pgdeck',
  trailingSlash: 'ignore',
  vite: { plugins: [tailwindcss()] },
});
