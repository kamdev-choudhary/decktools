<div align="center">

<img src="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/public/favicon.svg" alt="pgdeck logo" width="72" height="72" />

# pgdeck

**A fast, modern web UI for PostgreSQL, started with one command.**

Browse every database on your server, edit rows, run SQL, tune slow queries,
import and back up gigabytes, and watch live activity, all from your browser.

[![npm version](https://img.shields.io/npm/v/pgdeck?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/pgdeck)
[![npm downloads](https://img.shields.io/npm/dm/pgdeck?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/pgdeck)
[![Node.js](https://img.shields.io/node/v/pgdeck?style=flat-square&logo=nodedotjs&logoColor=white&color=339933)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12%2B-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/npm/l/pgdeck?style=flat-square&color=blue)](./LICENSE)
<br />
[![GitHub stars](https://img.shields.io/github/stars/kamdev-choudhary/pgdeck?style=flat-square&logo=github)](https://github.com/kamdev-choudhary/pgdeck/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/kamdev-choudhary/pgdeck?style=flat-square&logo=github)](https://github.com/kamdev-choudhary/pgdeck/issues)
[![Last commit](https://img.shields.io/github/last-commit/kamdev-choudhary/pgdeck?style=flat-square&logo=git&logoColor=white)](https://github.com/kamdev-choudhary/pgdeck/commits/main)
[![Install size](https://img.shields.io/npm/unpacked-size/pgdeck?style=flat-square&label=install%20size)](https://www.npmjs.com/package/pgdeck)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/kamdev-choudhary/pgdeck/pulls)

[**Website**](https://kamdev-choudhary.github.io/pgdeck/) ·
[**Quick start**](#quick-start) ·
[**Features**](#features) ·
[**Usage**](#usage) ·
[**Reverse proxy**](#behind-a-reverse-proxy) ·
[**Security**](#security) ·
[**Development**](#development)

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/overview-dark.png" />
  <img src="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/overview-light.png" alt="pgdeck live overview: connections, transactions per second, cache hit ratio and table storage" width="900" />
</picture>

</div>

---

## Quick start

```bash
npx pgdeck postgres://user:password@localhost:5432/mydb
```

That's it. pgdeck connects to your server, starts a local web app, and prints a
URL and a login. Open it to browse every database on the server. Put it behind
any reverse proxy to reach it remotely.

```
  pgdeck v0.1.3

  ✓ Connected   mydb as postgres (PostgreSQL 18.1)
    Databases   12 available (switch in the UI)
  ➜ Web UI      http://127.0.0.1:47615/
    Listening   127.0.0.1:47615
    Login       admin / 3fH9kQ2xLmP_
```

> [!TIP]
> No install needed. `npx` always runs the latest release. To pin a version,
> use `npx pgdeck@0.1.3`, or install globally with `npm i -g pgdeck`.

## Why pgdeck?

| | |
| --- | --- |
| **Zero setup** | One `npx` command. No Docker image, no config file, no desktop app. |
| **Whole server** | Switch between every database without restarting. |
| **Built for real data** | Streams imports and exports of any size; never loses `bigint`, `numeric` or timezone precision. |
| **Secure by default** | Generated password, localhost binding, CSRF protection, optional read-only mode. |
| **Proxy friendly** | One port, relative URLs, optional base path. Works behind nginx, Caddy or Traefik. |

## Features

### Explore

- **Every database on the server.** Switch from the header (or press <kbd>⌘</kbd> <kbd>K</kbd>)
  without restarting. The selected database is in the URL, so links and
  bookmarks keep it.
- **Live overview.** Connections, transactions/s, rows read and written per
  second, cache hit ratio and running sessions, streamed over a WebSocket.
  Plus storage per table (data vs. indexes), health checks (dead rows, missing
  indexes, never-analyzed tables, idle-in-transaction sessions) and a sortable
  list of every table.
- **Data grid.** Sort, paginate, and filter with `=`, `≠`, `<`, `>`, `contains`,
  `starts with`, `in`, `like`, `is null` and more, combined with **AND** or **OR**.
- **Foreign keys.** Columns show what they reference; preview the referenced
  row from any cell, jump to it, and pick values from the related table when
  editing. The Structure tab lists outgoing and incoming references.

### Edit

- **Editing that understands types.** Insert, edit and delete rows with editors
  that fit the column: true/false toggles, enum dropdowns, a calendar and time
  picker for dates and timestamps (timezone offset preserved), a JSON editor
  with validation, UUID generation, NULL and DEFAULT toggles.
- **Schema management.** Create tables with a column builder (types, defaults,
  primary key, unique, auto-increment, foreign keys) and a live SQL preview.
  On the Structure tab, add, edit (rename, change type, default, not null,
  comment) and drop columns; create indexes (multi-column, ASC/DESC, unique,
  btree/gin/gist/brin/hash, partial, concurrently) and drop indexes and
  constraints.
- **ER diagram.** An interactive map of tables and their foreign keys: auto
  layout, key-only or full columns, focus on one table and its neighbours, click
  to trace a table's links down to the exact columns, drag cards (positions are
  remembered), and export as PNG or SVG. Tables referenced almost everywhere
  (like `users`) have their links tucked away so the rest stays readable.
- **Functions, triggers, sequences and extensions.** Listed in the sidebar with
  their definitions. Edit and save functions (and trigger functions) in place,
  enable or disable triggers, set a sequence's next value, install, update or
  remove extensions, and drop any of them.
- **Table and database actions.** Rename, duplicate, truncate, drop, vacuum and
  analyze tables from a ⋯ menu; create, copy, rename and drop databases. Health
  checks can analyze or vacuum the affected tables in one click.

### Query

- **SQL editor.** Syntax highlighting and table autocomplete, run the
  selection or everything (<kbd>⌘</kbd> <kbd>Enter</kbd>), multiple statements, error
  position highlighting, per-database history.
- **Query performance.** Explain any statement (<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Enter</kbd>) as a plan
  tree with time per step, estimated vs. actual rows, the slowest step
  highlighted and plain-language warnings (filters discarding rows, sorts
  spilling to disk, bad row estimates). *Explain analyze* runs the query for
  real timings inside a transaction that is always rolled back. The overview
  lists the slowest queries from `pg_stat_statements` (with setup help if it's
  off) and lets you cancel a running query or terminate a session.

### Move data

- **Import gigabytes.** Stream CSV, TSV or JSON Lines files (optionally gzipped)
  straight into Postgres with `COPY`. Nothing is buffered, so file size doesn't
  matter. Columns are matched by name, you choose append or replace, and it
  runs in one transaction: a bad row rolls everything back and tells you the
  line. Upload progress, speed and time left are shown, and you can cancel.
- **Export anything.** All rows matching your filters (streamed from a server
  cursor, any size), the current page, or selected rows, as CSV, CSV for
  Excel, TSV, JSON, JSON Lines, SQL `INSERT` statements or Markdown.
- **Back up and restore whole databases.** The Export page writes a
  `pg_dump`-style `.sql` (optionally `.gz`) with schemas, types, sequences,
  functions, tables, data, indexes, foreign keys, views and triggers, from one
  consistent snapshot, or a ZIP with `schema.sql` plus one data file per table.
  Pick all tables or just some. The Import page restores `pg_dump` backups
  (plain SQL, or custom format when `pg_restore` is installed), recognised by
  content even without an extension, in a single transaction.

### And also

- **Safe defaults.** Login page with a generated password, binds to
  `127.0.0.1`, CSRF protection, optional read-only mode.
- **Light and dark themes.** Follows your system, or pick one.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/table-dark.png" />
        <img src="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/table-light.png" alt="Data grid with filters" />
      </picture>
      <p align="center"><sub><b>Data grid</b> with filters and type-aware editing</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/sql-dark.png" />
        <img src="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/sql-light.png" alt="SQL editor" />
      </picture>
      <p align="center"><sub><b>SQL editor</b> with autocomplete and history</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/structure-dark.png" />
        <img src="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/structure-light.png" alt="Table structure" />
      </picture>
      <p align="center"><sub><b>Structure</b>: columns, indexes, constraints, references</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/import-dark.png" />
        <img src="https://raw.githubusercontent.com/kamdev-choudhary/pgdeck/main/site/src/assets/shots/import-light.png" alt="Streaming import" />
      </picture>
      <p align="center"><sub><b>Import</b>: stream gigabytes straight into Postgres</sub></p>
    </td>
  </tr>
</table>

## Requirements

| | Version |
| --- | --- |
| [Node.js](https://nodejs.org) | 20 or newer |
| [PostgreSQL](https://www.postgresql.org) | 12 or newer |
| `pg_restore` *(optional)* | Only for restoring custom-format backups |

## Usage

```bash
npx pgdeck [connection-string] [options]
```

The connection string can name a database (`…/mydb`) or not (`…:5432`). Either
way you can switch to any database on the server from the UI. If you omit the
connection string, pgdeck uses `$DATABASE_URL`, then the standard `PG*`
environment variables (`PGHOST`, `PGUSER`, `PGDATABASE`, …).

### Options

| Option | Default | Description |
| --- | --- | --- |
| `-p, --port <port>` | `47615` (or `$PORT`) | Port for the web UI |
| `-H, --host <host>` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` in containers or to expose on a LAN |
| `-u, --user <name>` | `admin` | Login username |
| `-P, --password <password>` | random | Login password (or `$PGDECK_PASSWORD`). A new random one is printed on each start if not set |
| `--no-auth` | | Disable the login page. Only on a trusted machine |
| `--readonly` | | Open every database session read-only and disable editing |
| `--ssl` | | Connect with SSL without verifying the certificate (or add `sslmode=require` to the URL) |
| `--base-path <path>` | | Serve under a path prefix such as `/db` (see [reverse proxy](#behind-a-reverse-proxy)) |
| `--max-rows <n>` | `2000` | Maximum rows returned by a single query |
| `--open` | | Open the UI in your browser |
| `-v, --version` | | Print the version |
| `-h, --help` | | Show help |

### Environment variables

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | Connection string when none is passed as an argument |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, … | Standard libpq settings, used when neither of the above is set |
| `PGDECK_PASSWORD` | Login password (same as `--password`) |
| `PORT` | Web UI port (same as `--port`) |

### Examples

```bash
# Local database, open the browser automatically
npx pgdeck postgres://postgres@localhost:5432 --open

# Read-only access to production through an env var, fixed password
PGDECK_PASSWORD='correct horse battery staple' npx pgdeck "$DATABASE_URL" --readonly

# Managed Postgres that requires SSL
npx pgdeck "postgres://user:pass@db.example.com:5432/app?sslmode=require"

# Inside Docker / on a LAN
npx pgdeck postgres://postgres@db:5432 --host 0.0.0.0 --password "$SECRET"
```

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>⌘</kbd> <kbd>K</kbd> | Switch database / command menu |
| <kbd>⌘</kbd> <kbd>Enter</kbd> | Run the selection, or the whole editor |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Enter</kbd> | Explain the statement |

<sub>On Windows and Linux, use <kbd>Ctrl</kbd> in place of <kbd>⌘</kbd>.</sub>

## Behind a reverse proxy

pgdeck is a single server on one port, so proxying it is straightforward. The
UI uses relative URLs, which means it works at the root of a domain or under a
path. Two things matter:

1. **Forward WebSocket upgrades.** The live overview uses `/api/db/<name>/live`.
2. **Under a path, either strip the prefix in the proxy, or pass the same
   prefix with `--base-path`.** Either way, open the URL with a trailing slash
   (`https://example.com/db/`).

<details>
<summary><b>nginx</b></summary>

```nginx
# pgdeck started with: npx pgdeck "$DATABASE_URL" --base-path /db --password "$SECRET"
location /db/ {
    proxy_pass http://127.0.0.1:47615;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Large imports: no body limit, stream uploads, allow long requests.
    client_max_body_size 0;
    proxy_request_buffering off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

</details>

<details>
<summary><b>Caddy</b></summary>

```caddy
example.com {
    handle_path /db/* {
        reverse_proxy 127.0.0.1:47615
    }
}
```

`handle_path` strips `/db`, so start pgdeck **without** `--base-path` here.
Caddy forwards WebSockets automatically.

</details>

### Health check

`GET /healthz` returns `{"ok":true}` without logging in.

## Security

> [!WARNING]
> pgdeck gives anyone who logs in full access to the database role it connects
> as. Treat it like a database password.

- **Login.** On by default, with a random password printed at startup. Sessions
  are HTTP-only, `SameSite=Strict` cookies kept in memory. Restarting pgdeck
  logs everyone out. Failed logins are rate-limited per client address.
- **Imports.** Uploads have no size limit and no request timeout. If you put
  pgdeck behind a proxy, raise its body-size and timeout limits too (for nginx:
  `client_max_body_size 0; proxy_request_buffering off; proxy_read_timeout 1h;`).
- **Network.** Binds to `127.0.0.1` unless you pass `--host`. pgdeck warns at
  startup if you combine a public interface with `--no-auth`.
- **CSRF.** API calls require a custom header, and WebSocket connections check
  the `Origin`, so other websites can't use your session.
- **HTTPS.** pgdeck serves plain HTTP. Terminate TLS at your reverse proxy;
  the session cookie is marked `Secure` when the proxy sends
  `X-Forwarded-Proto: https`.
- **Least privilege.** For anything sensitive, connect as a role that only has
  the access you need. `--readonly` sets `default_transaction_read_only` on
  every session and turns off editing in the UI. It's a safety net, not a
  security boundary: a role that may write can still switch it off in the SQL
  editor.

Found a vulnerability? Please report it privately through
[GitHub security advisories](https://github.com/kamdev-choudhary/pgdeck/security/advisories/new)
rather than a public issue.

## How values are handled

pgdeck reads every value as Postgres' own text representation and sends edits
back the same way, letting Postgres cast them. That means timestamps keep
their timezone and precision, `bigint` and `numeric` never lose digits, and
anything you can type in `psql` works in the editor. Rows are identified by
primary key, or by `ctid` for tables without one. Views can be browsed but not
edited.

## Development

```bash
git clone https://github.com/kamdev-choudhary/pgdeck.git
cd pgdeck
pnpm install

# API on :47615 (no login) + Vite UI with hot reload on :47616
DATABASE_URL=postgres://postgres@localhost:5432 pnpm dev
```

Open <http://localhost:47616>.

| Script | What it does |
| --- | --- |
| `pnpm dev` | API with auto-restart and the UI with hot reload |
| `pnpm build` | Build the UI (Vite) and the CLI (tsdown) into `dist/` |
| `pnpm start` | Run the built CLI |
| `pnpm typecheck` | Type-check the server and the UI |
| `pnpm pack:check` | Build and list exactly what would be published |
| `pnpm site:dev` | Run the landing page (Astro) locally |

### Project layout

```
src/
  cli/        command-line entry, options, startup banner
  server/     Hono app: auth, API routes, live WebSocket, static UI
  db/         connection pools per database, introspection, rows, SQL, stats
  shared/     types shared by the server and the UI
web/
  src/
    api/          typed API client, React Query hooks, live socket hook
    components/   shadcn/ui primitives (ui/) and app components (app/)
    views/        overview, table (data + structure), SQL editor, login
    lib/          router, theme, formatting, storage helpers
site/         landing page (Astro), deployed to GitHub Pages
```

### Built with

[![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white)](https://hono.dev)
[![node-postgres](https://img.shields.io/badge/node--postgres-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://node-postgres.com)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![TanStack Query](https://img.shields.io/badge/TanStack_Query-FF4154?style=flat-square&logo=reactquery&logoColor=white)](https://tanstack.com/query)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000000?style=flat-square&logo=shadcnui&logoColor=white)](https://ui.shadcn.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-D30707?style=flat-square&logo=codemirror&logoColor=white)](https://codemirror.net)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![tsdown](https://img.shields.io/badge/tsdown-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://tsdown.dev)

## Contributing

Contributions are welcome! Bug reports and feature requests go in
[issues](https://github.com/kamdev-choudhary/pgdeck/issues). For code changes:

1. Fork the repo and create a branch from `main`.
2. Run `pnpm dev` against a local Postgres and make your change.
3. Make sure `pnpm typecheck` and `pnpm build` pass.
4. Open a pull request describing what changed and why.

If pgdeck saves you time, consider giving it a ⭐ on GitHub.

## License

Released under the [MIT License](./LICENSE).
