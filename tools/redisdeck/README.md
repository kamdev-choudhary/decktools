<div align="center">

# redisdeck

**A fast, modern web UI for Redis, started with one command.**

Browse and edit keys of every type, run commands in a console, and watch live
server stats, from your browser. No install, no account, no agent on the server.

[![npm version](https://img.shields.io/npm/v/redisdeck?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/redisdeck)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

</div>

## Quick start

```bash
npx redisdeck                                   # redis://127.0.0.1:6379
npx redisdeck redis://:secret@localhost:6379/2  # password, database 2
npx redisdeck rediss://default:secret@cache.example.com:6380 --readonly
```

redisdeck prints a link and a login. Open the link and you're in.

## Features

- **Key browser.** Search by text or glob pattern (`user:*`), filter by type,
  and scroll through millions of keys: listing uses `SCAN`, never `KEYS`, so
  it doesn't block the server. Every key shows its type and time to live.
- **Editors for every type.** Strings (with JSON formatting), hashes, lists,
  sets, sorted sets, streams and RedisJSON documents. Add, edit and delete
  fields, elements and members; large collections load page by page.
- **Key actions.** Create keys of any type, rename (never overwrites), set or
  remove expiry, and delete.
- **Console.** Run any command, with output shaped like `redis-cli`, exact
  integers, and history (↑/↓).
- **Server overview.** Live operations per second, memory, network and
  clients; cache hit ratio; keyspace per database; and the slow log.
- **All logical databases.** Switch between db0 to db15 (or however many the
  server has) from the header.
- **Binary safe.** Keys and values that aren't UTF-8 are shown escaped
  (`\xff`) and are never corrupted by an edit.

## Options

```
npx redisdeck [redis-url] [options]
```

| Option                      | Description                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `[redis-url]`               | `redis://` or `rediss://` (TLS) URL. Default: `$REDIS_URL`, then `redis://127.0.0.1:6379`. A path selects the database the UI opens on (`/2`). |
| `-p, --port <port>`         | Port for the web UI (default `47815`, or `$PORT`)                                                                                              |
| `-H, --host <host>`         | Interface to bind (default `127.0.0.1`; `0.0.0.0` for containers/LAN)                                                                          |
| `-u, --user <name>`         | Login username (default `admin`)                                                                                                               |
| `-P, --password <password>` | Login password (default: random, printed at startup; or `$REDISDECK_PASSWORD`)                                                                 |
| `--no-auth`                 | Disable the login page (only on a trusted machine)                                                                                             |
| `--readonly`                | Refuse every change: edits, deletes and write commands                                                                                         |
| `--tls-insecure`            | With `rediss://`, skip verifying the server certificate                                                                                        |
| `--base-path <path>`        | Serve under a path prefix, e.g. `/redis`, if your proxy does not strip it                                                                      |
| `--open`                    | Open the UI in your browser                                                                                                                    |

## Read-only mode

With `--readonly`, redisdeck refuses every edit, and the console only runs
commands Redis itself flags as read-only. It uses Redis's own command metadata
(`COMMAND INFO`), so writes, `EVAL` (use `EVAL_RO`), `PUBLISH` and admin
commands such as `CONFIG SET` are refused, while `GET`, `SCAN`, `INFO`,
`CONFIG GET` and `SLOWLOG GET` work. For defence in depth, also connect as a
Redis ACL user that can only read.

## Console limits

The console shares one connection per database, so commands that need a
connection to themselves are refused: `SUBSCRIBE`, `MONITOR`, `MULTI`/`EXEC`,
`WATCH`, blocking pops (`BLPOP`...), and `SELECT` (switch databases with the
menu instead).

## Security

- The UI binds to `127.0.0.1` by default. To reach a server remotely, use an
  SSH tunnel (`ssh -L 47815:127.0.0.1:47815 <server>`) or a reverse proxy.
- Login is on by default, with a random password printed at startup. Sessions
  live in memory, are `HttpOnly` and `SameSite=Strict`, and failed logins are
  rate-limited.
- Every API call requires a custom header, so other sites can't make requests
  on your behalf.

## Development

redisdeck lives in the [decktools](https://github.com/kamdev-choudhary/decktools)
monorepo, under `tools/redisdeck`. It is built on the shared `@deck/*`
packages, which are bundled into the published package.

```bash
git clone https://github.com/kamdev-choudhary/decktools.git
cd decktools
pnpm install
cd tools/redisdeck

# API on :47815 (no login) + Vite UI with hot reload on :47816
REDIS_URL=redis://127.0.0.1:6379 pnpm dev
```

| Script                         | What it does                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | API with auto-restart and the UI with hot reload                                                                       |
| `pnpm build`                   | Build the UI (Vite) and the CLI (tsdown) into `dist/`                                                                  |
| `pnpm test`                    | Integration tests against a throwaway `redis-server` they start themselves (skipped if `redis-server` isn't installed) |
| `pnpm lint` / `pnpm typecheck` | oxlint and TypeScript                                                                                                  |
| `pnpm pack:check`              | Build and list exactly what would be published                                                                         |

```
src/
  cli/      command-line entry, options, startup banner
  redis/    connections per database, SCAN, type-aware reads and edits, console, INFO
  server/   Hono routes and request validation (on @deck/server)
  shared/   types shared by the server and the UI
web/src/
  views/    key browser and value editors, console, server overview, login
test/       integration tests (node:test)
```

## License

[MIT](./LICENSE)
