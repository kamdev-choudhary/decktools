# decktools

Zero-install web UIs for your infrastructure. Each **deck** is a small, open
source admin panel for one system: run it with `npx`, open the link it prints,
and you're in.

| Deck | For | Run it | Docs |
| --- | --- | --- | --- |
| [**pgdeck**](tools/pgdeck) | PostgreSQL | `npx pgdeck postgres://localhost:5432` | [README](tools/pgdeck#readme) |
| [**s3deck**](tools/s3deck) | S3 and S3-compatible storage | `npx s3deck` | [README](tools/s3deck#readme) |

Website: <https://kamdev-choudhary.github.io/decktools/>

## Repository layout

```
tools/                 one folder per deck, each published to npm under its own name
  pgdeck/              → npm "pgdeck"
  s3deck/              → npm "s3deck"
packages/              internal shared libraries (private, never published)
  cli/       @deck/cli       standard web-UI flags, startup banner, shutdown, open browser
  config/    @deck/config    base path, host and auth credential resolution
  logger/    @deck/logger    terminal colors, aligned labels, prefixed logging
  security/  @deck/security  sessions, login rate limiting, constant-time compare, redaction, CSP
  server/    @deck/server    Hono app shell: base path, cookie login, CSRF, static UI, listen()
  ui/        @deck/ui        shadcn/ui components, theme, fonts, design tokens CSS
site/                  the website: a hub page plus one folder per deck in src/decks/<slug>
```

### How the shared packages ship

The `@deck/*` packages are **source-only TypeScript**: no build step and no
npm release. A deck lists them as `devDependencies` (`workspace:*`), and its
build inlines them. tsdown bundles the server and CLI, and Vite bundles the
UI. The published tarball is self-contained, so `npx <deck>` works exactly
like a single-package project. Third-party runtime libraries stay in the
deck's `dependencies` and are installed by npm as usual. A `beforePacking`
hook in [`.pnpmfile.cjs`](.pnpmfile.cjs) strips the internal packages from the
published `package.json`.

Currently pgdeck is built on the shared packages. s3deck was moved in as-is
and keeps its own server and UI code for now; it can adopt `@deck/*` piece by
piece.

## Development

Requires Node.js 20+ and pnpm (the version is pinned in `packageManager`).

```bash
pnpm install
pnpm check            # lint + typecheck + test + build, everything
```

| Script (root) | What it does |
| --- | --- |
| `pnpm lint` | oxlint over the whole repo ([`.oxlintrc.json`](.oxlintrc.json)) |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run every package's tests |
| `pnpm build` | Build every deck in `tools/` |
| `pnpm dev` | Run pgdeck in dev mode (API + hot-reloading UI) |
| `pnpm --filter <deck> <script>` | Run any script of one deck, e.g. `pnpm --filter s3deck dev` |
| `pnpm site:dev` / `pnpm site:build` | Work on the website |
| `npx pgdeck` / `npx s3deck` | Run your local build of a deck (after `pnpm build`) |

Each deck can also be worked on from its own folder (`cd tools/pgdeck && pnpm dev`).

### Publishing a deck

Publish from the deck's folder with **pnpm** (not npm), so the workspace hook runs:

```bash
cd tools/pgdeck
pnpm version patch
pnpm publish          # prepublishOnly runs lint, typecheck, tests and the build
```

`pnpm pack:check` lists exactly what would be published.

## Adding a new deck

1. **Create `tools/<name>/`** with a `package.json` named after the npm package.
   Copy pgdeck's scripts, `tsconfig.json` (extends `../../tsconfig.base.json`),
   `tsdown.config.ts` and `web/` setup (`web/tsconfig.json` extends
   `../../../tsconfig.web.json`).
2. **Depend on what you need** from `packages/*` as `devDependencies`
   (`"@deck/server": "workspace:*"`), and put their third-party runtime
   dependencies (`hono`, `@hono/node-server`, `commander`, `picocolors`,
   `open`, `zod`) in the deck's `dependencies` so they stay external.
3. **Server and CLI:** build the app with `createDeckApp()` from
   `@deck/server`, the flags with `serverOptions()` from `@deck/cli`, and print
   the banner with `printBanner()`. pgdeck's `src/server/app.ts` and
   `src/cli/index.ts` are the reference. Choose a unique default port, session
   cookie name and CSRF header (for example `x-<name>`).
4. **UI:** import components from `@deck/ui/components/*`, start your
   stylesheet with `@import 'tailwindcss'; @import 'tw-animate-css'; @import '@deck/ui/styles.css';`,
   wrap the app in `<ThemeProvider storageKey="<name>.theme">`, and add
   `dedupe: ['react', 'react-dom']` to the Vite config.
5. **Website:** add the deck to [`site/src/decks/index.ts`](site/src/decks/index.ts).
   For a full landing page, put its sections in `site/src/decks/<name>/` and
   the page in `site/src/pages/<name>/index.astro`, then set `hasPage: true`.
6. Add the CLI to the smoke-test and pack steps in
   [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

[MIT](LICENSE)
