# pgdeck

A fast, modern web UI for PostgreSQL that you start with one command.

```bash
npx pgdeck postgres://user:password@localhost:5432/mydb
```

pgdeck connects to your server, starts a local web app, and prints a URL and a
login. Open it to browse every database on the server, edit rows, run SQL, and
watch live activity. Put it behind any reverse proxy to reach it remotely.

## Features

- **Every database on the server.** Switch from the header (or press <kbd>⌘K</kbd>)
  without restarting. The selected database is in the URL, so links and
  bookmarks keep it.
- **Live overview.** Connections, transactions/s, rows read and written per
  second, cache hit ratio and running sessions, streamed over a WebSocket.
  Plus storage per table (data vs. indexes), health checks (dead rows, missing
  indexes, never-analyzed tables, idle-in-transaction sessions) and a sortable
  list of every table.
- **Data grid.** Sort, paginate, and filter with `=`, `≠`, `<`, `>`, `contains`,
  `starts with`, `in`, `like`, `is null` and more, combined with **AND** or **OR**.
  Export the current page as CSV.
- **Editing that understands types.** Insert, edit and delete rows with editors
  that fit the column: true/false toggles, enum dropdowns, a calendar and time
  picker for dates and timestamps (timezone offset preserved), a JSON editor
  with validation, UUID generation, NULL and DEFAULT toggles.
- **SQL editor.** Syntax highlighting and table autocomplete, run the
  selection or everything (<kbd>⌘ Enter</kbd>), multiple statements, error
  position highlighting, per-database history.
- **Structure view.** Columns, indexes and constraints for every table.
- **Safe defaults.** Login page with a generated password, binds to
  `127.0.0.1`, CSRF protection, optional read-only mode.
- **Light and dark themes.** Follows your system, or pick one.

## Requirements

- Node.js 20 or newer
- A PostgreSQL server you can connect to, version 12 or newer

## Usage

```bash
npx pgdeck [connection-string] [options]
```

The connection string can name a database (`…/mydb`) or not (`…:5432`). Either
way you can switch to any database on the server from the UI. If you omit the
connection string, pgdeck uses `$DATABASE_URL`, then the standard `PG*`
environment variables (`PGHOST`, `PGUSER`, `PGDATABASE`, …).

When it starts you'll see something like:

```
  pgdeck v0.1.0

  ✓ Connected   mydb as postgres (PostgreSQL 18.1)
    Databases   12 available (switch in the UI)
  ➜ Web UI      http://127.0.0.1:47615/
    Listening   127.0.0.1:47615
    Login       admin / 3fH9kQ2xLmP_
```

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

## Behind a reverse proxy

pgdeck is a single server on one port, so proxying it is straightforward. The
UI uses relative URLs, which means it works at the root of a domain or under a
path. Two things matter:

1. **Forward WebSocket upgrades.** The live overview uses `/api/db/<name>/live`.
2. **Under a path, either strip the prefix in the proxy, or pass the same
   prefix with `--base-path`.** Either way, open the URL with a trailing slash
   (`https://example.com/db/`).

### nginx

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
}
```

### Caddy

```caddy
example.com {
    handle_path /db/* {
        reverse_proxy 127.0.0.1:47615
    }
}
```

`handle_path` strips `/db`, so start pgdeck **without** `--base-path` here.
Caddy forwards WebSockets automatically.

### Health check

`GET /healthz` returns `{"ok":true}` without logging in.

## Security

pgdeck gives anyone who logs in full access to the database role it connects
as. Treat it like a database password.

- **Login.** On by default, with a random password printed at startup. Sessions
  are HTTP-only, `SameSite=Strict` cookies kept in memory. Restarting pgdeck
  logs everyone out. Failed logins are rate-limited per client address.
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

## How values are handled

pgdeck reads every value as Postgres' own text representation and sends edits
back the same way, letting Postgres cast them. That means timestamps keep
their timezone and precision, `bigint` and `numeric` never lose digits, and
anything you can type in `psql` works in the editor. Rows are identified by
primary key, or by `ctid` for tables without one. Views can be browsed but not
edited.

## Development

```bash
git clone https://github.com/kamdev-bharatai/project-db.git
cd project-db
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
```

Built with [Hono](https://hono.dev), [node-postgres](https://node-postgres.com),
[React](https://react.dev), [TanStack Query](https://tanstack.com/query),
[shadcn/ui](https://ui.shadcn.com), [Tailwind CSS](https://tailwindcss.com),
[CodeMirror](https://codemirror.net), [Vite](https://vite.dev) and
[tsdown](https://tsdown.dev).

## License

[MIT](./LICENSE)
