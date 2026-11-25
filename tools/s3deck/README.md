<div align="center">

# s3deck

**A fast, modern web UI for S3 and S3-compatible storage, started with one command.**

Browse buckets, preview files, upload and download gigabytes, share links and
manage bucket settings on AWS S3, Cloudflare R2, MinIO, Backblaze B2 and more,
all from your browser.

[![npm version](https://img.shields.io/npm/v/s3deck?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/s3deck)
[![npm downloads](https://img.shields.io/npm/dm/s3deck?style=flat-square&color=cb3837)](https://www.npmjs.com/package/s3deck)
[![CI](https://img.shields.io/github/actions/workflow/status/kamdev-choudhary/decktools/ci.yml?branch=main&style=flat-square&logo=github&label=CI)](https://github.com/kamdev-choudhary/decktools/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/kamdev-choudhary/decktools/pulls)

[**Quick start**](#quick-start) ·
[**Features**](#features) ·
[**Providers**](#supported-providers) ·
[**Usage**](#usage) ·
[**Reverse proxy**](#behind-a-reverse-proxy) ·
[**Security**](#security) ·
[**Development**](#development)

</div>

> [!NOTE]
> s3deck is pre-1.0. It is usable today, but options and APIs may change
> between minor versions until 1.0. Check the
> [releases](https://github.com/kamdev-choudhary/decktools/releases) before upgrading.

---

## Quick start

```bash
# AWS S3, using your usual AWS credentials (env vars, ~/.aws, SSO, …)
npx s3deck

# Any S3-compatible endpoint
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… npx s3deck http://localhost:9000
```

s3deck connects to your storage, starts a local web app, and prints a URL and
a login. Open it to browse every bucket the credentials can see. Put it behind
any reverse proxy to reach it remotely.

```
  s3deck v0.1.0

  ✓ Connected   MinIO at http://localhost:9000 (region us-east-1)
    Buckets     8 available
  ➜ Web UI      http://127.0.0.1:47715/
    Reachable   from this machine only (remote: ssh -L 47715:127.0.0.1:47715 …)
    Login       admin / 3fH9kQ2xLmP_
```

> [!TIP]
> No install needed. `npx` always runs the latest release. To pin a version,
> use `npx s3deck@0.1.0`, or install globally with `npm i -g s3deck`.

## Why s3deck?

|                             |                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Zero setup**              | One `npx` command. No Docker image, no desktop app, no bucket CORS changes.                              |
| **Any S3 provider**         | AWS, R2, MinIO, B2, Spaces, Wasabi and more. Features a provider doesn't support are hidden, not broken. |
| **Built for big buckets**   | Lists millions of objects page by page; uploads and downloads stream, so file size doesn't matter.       |
| **Keys stay on the server** | The browser never sees your access keys. Every request is signed server-side.                            |
| **Secure by default**       | Generated password, localhost binding, CSRF protection, optional read-only mode.                         |

## Features

### Browse

- **Every bucket in one place.** Switch from the sidebar (or press <kbd>⌘</kbd> <kbd>K</kbd>).
  The bucket and folder are in the URL, so links and bookmarks keep them.
- **Folders that feel like folders.** Navigate prefixes with breadcrumbs, sort
  by name, size, date or storage class, and filter the current folder as you
  type. Large folders load page by page while you scroll.
- **Search by prefix** across the whole bucket, not just the current folder.
- **Previews.** Images, video, audio, PDF, text and code (with syntax
  highlighting), JSON (formatted), CSV (as a table) and Markdown open in a side
  panel. Large files are previewed from their first bytes only.
- **Object details.** Size, ETag, storage class, last modified, version ID,
  content type and every header and custom metadata field.

### Move files

- **Upload anything.** Drag files or whole folders onto the page, or paste
  (<kbd>⌘</kbd> <kbd>V</kbd>) a screenshot. Large files go up in parallel parts
  with progress, speed, time left, pause and cancel. Uploads stream through
  s3deck, so the bucket needs no CORS rules.
- **Resumable uploads.** Parts are retried automatically. If the network drops
  or you close the tab, add the same file again and it continues from the parts
  already uploaded.
- **Download anything.** Single files stream straight from storage. Select
  several files or a folder to download them as one ZIP, built on the fly
  without temporary files.
- **Copy, move and rename** files and folders, inside a bucket or between
  buckets, using server-side copy (multipart copy for files over 5 GB). Nothing
  passes through your machine.
- **Drag to move.** Drop files and folders onto a folder, a breadcrumb or the
  up arrow to move them there.
- **Delete safely.** Deleting a folder shows how many objects and bytes it
  contains before you confirm, then removes them in batches of 1,000. On
  versioned buckets, **Show deleted files** lists deleted objects so you can
  restore them in one click.
- **Sync and compare.** Compare two folders, even on different connections or
  providers (say R2 → S3), see what's missing or different, then copy or mirror
  in a background job with live progress.

### Share

- **Presigned links.** Create a download link for any object with an expiry
  from minutes to 7 days, and copy it in one click. Create upload links that let
  someone put one file at a given key.
- **Public URLs.** For public buckets, copy the object's direct URL (or your
  custom domain's URL, if you set one).

### Manage

- **Buckets.** Create and delete buckets (with an "empty it first" option),
  choose the region and see each bucket's settings at a glance.
- **Metadata and tags.** Edit `Content-Type`, `Cache-Control`,
  `Content-Disposition`, custom `x-amz-meta-*` fields and object tags, on one
  object or many at once.
- **Versions.** On versioned buckets, list an object's versions and delete
  markers, preview or download any of them, restore an older version and
  permanently delete versions.
- **Bucket settings.** Turn versioning on or off, and edit CORS rules,
  lifecycle rules, the bucket policy and public access settings, each with a
  JSON editor that validates before saving.
- **Storage usage.** Calculate the size and object count of a bucket or folder,
  broken down by subfolder and storage class. It runs on demand, because it has
  to list every object. Any folder row can also show its size on demand.
- **Storage classes and archives.** Move objects between storage classes, and
  restore Glacier / Deep Archive objects (choose the speed and how long the copy
  stays). Archived objects are marked, and their preview explains what to do.
- **Encryption and object lock.** See each object's encryption and KMS key,
  retention and legal hold, and the bucket's default encryption and lock rules.
- **Incomplete uploads.** List multipart uploads that never finished (they're
  billed until aborted) and clean them up.

### And also

- **Safe defaults.** Login page with a generated password, binds to
  `127.0.0.1`, CSRF protection, optional read-only mode.
- **Grid view.** Switch the folder view to a grid with image thumbnails.
- **Light and dark themes.** Follows your system, or pick one.

### Teams

- **Users and roles.** Add people with their own login: **viewers** browse,
  preview, download and share; **editors** also upload, edit, move and delete;
  **admins** also manage buckets, bucket settings, users and the activity log.
- **Single sign-on.** Let people sign in with Google, Microsoft, Okta, Auth0,
  Keycloak or any OpenID Connect provider (see [Single sign-on](#single-sign-on)).
- **Remembered connections.** Tick _Remember this connection_ when entering
  keys in the browser. They're stored on the server encrypted (AES-256-GCM),
  belong to your user, and are still there after a restart.
- **Activity log.** Every change (uploads, deletes, moves, settings, sign-ins)
  with who, when and from which address, filterable by user and bucket.

## Supported providers

s3deck talks the S3 API, so it works with any compatible service. Features a
provider doesn't implement (such as versioning on R2) are detected and hidden.

| Provider                                                                                                                                   | Endpoint example                                | Notes                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------- |
| [AWS S3](https://aws.amazon.com/s3/)                                                                                                       | _(none needed)_                                 | Every feature                                 |
| [Cloudflare R2](https://developers.cloudflare.com/r2/)                                                                                     | `https://<account-id>.r2.cloudflarestorage.com` | Region `auto`. No versioning or object tags   |
| [MinIO](https://min.io)                                                                                                                    | `http://localhost:9000`                         | Uses path-style URLs automatically            |
| [Backblaze B2](https://www.backblaze.com/cloud-storage)                                                                                    | `https://s3.us-west-004.backblazeb2.com`        |                                               |
| [DigitalOcean Spaces](https://www.digitalocean.com/products/spaces)                                                                        | `https://nyc3.digitaloceanspaces.com`           |                                               |
| [Wasabi](https://wasabi.com)                                                                                                               | `https://s3.eu-central-1.wasabisys.com`         |                                               |
| [Ceph RGW](https://docs.ceph.com/en/latest/radosgw/), [Garage](https://garagehq.deuxfleurs.fr), [LocalStack](https://www.localstack.cloud) | your gateway URL                                | Path-style URLs; use `--path-style` if needed |

## Requirements

|                               | Version                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org) | 20 or newer                                                                              |
| Credentials                   | An access key with permission to list buckets, or `--bucket` to open one bucket directly |

## Usage

```bash
npx s3deck [endpoint] [options]
```

Leave out the endpoint for AWS S3. For any other provider, pass its S3
endpoint URL. Credentials come from the standard AWS sources, in this order:

1. `--access-key` and `--secret-key`
2. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN`)
3. A profile from `~/.aws/credentials` or `~/.aws/config` (`--profile` or
   `AWS_PROFILE`), including SSO and assumed roles
4. Instance, container or web identity credentials when running in AWS

No credentials? s3deck still starts, and you can **enter them in the browser**:
pick a provider (AWS, R2, MinIO, B2, Spaces, Wasabi or any S3-compatible
endpoint), paste an access key and connect. Keys entered this way are sent once
to the s3deck server, kept only in its memory for your session, never sent back
to the browser and forgotten on logout or restart. You can add several
connections and switch between them from the sidebar. Disable this with
`--no-browser-connections`.

### Options

| Option                      | Default                       | Description                                                                                  |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `-p, --port <port>`         | `47715` (or `$PORT`)          | Port for the web UI                                                                          |
| `-H, --host <host>`         | `127.0.0.1`                   | Interface to bind. Use `0.0.0.0` in containers or to expose on a LAN                         |
| `-u, --user <name>`         | `admin`                       | Login username                                                                               |
| `-P, --password <password>` | random                        | Login password (or `$S3DECK_PASSWORD`). A new random one is printed on each start if not set |
| `--no-auth`                 |                               | Disable the login page. Only on a trusted machine                                            |
| `--region <region>`         | from config, else `us-east-1` | Region to sign requests for (or `$AWS_REGION`)                                               |
| `--profile <name>`          |                               | AWS profile to use (or `$AWS_PROFILE`)                                                       |
| `--access-key <id>`         |                               | Access key ID. Prefer the environment variable, so it stays out of shell history             |
| `--secret-key <secret>`     |                               | Secret access key. Same advice                                                               |
| `--session-token <token>`   |                               | Session token for temporary credentials (or `$AWS_SESSION_TOKEN`)                            |
| `--path-style`              | auto                          | Use path-style URLs (`host/bucket/key`) instead of virtual-hosted style                      |
| `--bucket <name>`           |                               | Open this bucket directly. Use it when the key may not list buckets. Repeat for several      |
| `--readonly`                |                               | Disable uploads, edits and deletes in the UI and the API                                     |
| `--base-path <path>`        |                               | Serve under a path prefix such as `/s3` (see [reverse proxy](#behind-a-reverse-proxy))       |
| `--open`                    |                               | Open the UI in your browser                                                                  |
| `--data-dir <dir>`          | `~/.config/s3deck`            | Where users, remembered connections and the activity log are kept (or `$S3DECK_DATA_DIR`)    |
| `--no-persist`              |                               | Write nothing to disk: no extra users, remembered connections or activity file               |
| `--public-url <url>`        | from the request              | Public URL of s3deck, for single sign-on redirects (or `$S3DECK_PUBLIC_URL`)                 |
| `--no-browser-connections`  |                               | Don't let users enter credentials in the browser                                             |
| `-v, --version`             |                               | Print the version                                                                            |
| `-h, --help`                |                               | Show help                                                                                    |

### Environment variables

| Variable                                                          | Used for                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Credentials                                                                                              |
| `AWS_PROFILE`, `AWS_REGION`                                       | Profile and region (same as `--profile`, `--region`)                                                     |
| `AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL`                         | Endpoint when none is passed as an argument                                                              |
| `S3DECK_PASSWORD`                                                 | Login password (same as `--password`)                                                                    |
| `PORT`                                                            | Web UI port (same as `--port`)                                                                           |
| `S3DECK_DATA_DIR`                                                 | Data directory (same as `--data-dir`)                                                                    |
| `S3DECK_SECRET`                                                   | Passphrase that encrypts remembered connections. If unset, a random key is created in the data directory |
| `S3DECK_PUBLIC_URL`                                               | Public URL (same as `--public-url`)                                                                      |
| `S3DECK_OIDC_*`                                                   | Single sign-on, see below                                                                                |

### Examples

```bash
# AWS with a named profile, open the browser automatically
npx s3deck --profile prod --open

# Local MinIO with its default credentials
AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin npx s3deck http://localhost:9000

# Cloudflare R2, read-only
npx s3deck "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com" --region auto --readonly

# A key that can only access one bucket
npx s3deck --bucket my-app-uploads

# Inside Docker / on a LAN
npx s3deck http://minio:9000 --host 0.0.0.0 --password "$SECRET"
```

### Keyboard shortcuts

| Shortcut                  | Action                                    |
| ------------------------- | ----------------------------------------- |
| <kbd>⌘</kbd> <kbd>K</kbd> | Switch bucket / command menu              |
| <kbd>⌘</kbd> <kbd>U</kbd> | Upload files                              |
| <kbd>Space</kbd>          | Preview the selected file                 |
| <kbd>Enter</kbd>          | Open a folder                             |
| <kbd>⌫</kbd>              | Go up one folder                          |
| <kbd>⌘</kbd> <kbd>A</kbd> | Select everything in the folder           |
| <kbd>⌘</kbd> <kbd>V</kbd> | Upload pasted files or screenshots        |
| <kbd>/</kbd>              | Filter the folder                         |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move between rows                         |
| <kbd>Esc</kbd>            | Close the preview, or clear the selection |

<sub>On Windows and Linux, use <kbd>Ctrl</kbd> in place of <kbd>⌘</kbd>.</sub>

## Users, data and single sign-on

The login printed at startup is always an **admin**. Admins add more people on
the **Users** page. Users, remembered connections and the activity log live in
the data directory (`~/.config/s3deck` by default, mode `0700`):

| File              | Contents                                           |
| ----------------- | -------------------------------------------------- |
| `users.json`      | Users, roles and scrypt password hashes            |
| `connections.enc` | Remembered connections, encrypted with AES-256-GCM |
| `secret.key`      | The encryption key, unless `S3DECK_SECRET` is set  |
| `activity.jsonl`  | The activity log (rotated at 10 MB)                |

Back up the data directory together with its key: without `secret.key` (or the
same `S3DECK_SECRET`), remembered connections can't be decrypted.

### Single sign-on

Any OpenID Connect provider works. Register s3deck as a web application with
the redirect URL `https://<your s3deck>/api/auth/sso/callback`, then:

```bash
S3DECK_OIDC_ISSUER=https://accounts.google.com \
S3DECK_OIDC_CLIENT_ID=… S3DECK_OIDC_CLIENT_SECRET=… \
S3DECK_OIDC_LABEL="Sign in with Google" \
S3DECK_OIDC_ALLOW="@example.com, contractor@gmail.com" \
S3DECK_OIDC_DEFAULT_ROLE=viewer \
S3DECK_PUBLIC_URL=https://files.example.com \
npx s3deck
```

| Variable                                             | Meaning                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `S3DECK_OIDC_ISSUER`                                 | Issuer URL (discovery is automatic)                                                                                |
| `S3DECK_OIDC_CLIENT_ID`, `S3DECK_OIDC_CLIENT_SECRET` | Client credentials                                                                                                 |
| `S3DECK_OIDC_LABEL`                                  | Button text on the login page                                                                                      |
| `S3DECK_OIDC_ALLOW`                                  | Emails or `@domains` allowed in. People added on the Users page (by email) are always allowed, with their own role |
| `S3DECK_OIDC_DEFAULT_ROLE`                           | Role for allowed people who aren't on the Users page (`viewer` by default)                                         |

Sign-in uses the authorization code flow with PKCE, and only accepts verified
email addresses.

## Behind a reverse proxy

s3deck is a single server on one port, and the UI uses relative URLs, so it
works at the root of a domain or under a path. Two things matter:

1. **Large transfers.** Uploads and downloads stream through s3deck, so turn
   off the proxy's body-size limit and request buffering, and allow long
   requests.
2. **Under a path, either strip the prefix in the proxy, or pass the same
   prefix with `--base-path`.** Either way, open the URL with a trailing slash
   (`https://example.com/s3/`).

<details>
<summary><b>nginx</b></summary>

```nginx
# s3deck started with: npx s3deck --base-path /s3 --password "$SECRET"
location /s3/ {
    proxy_pass http://127.0.0.1:47715;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Large uploads and downloads: no body limit, stream both ways, long requests.
    client_max_body_size 0;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

</details>

<details>
<summary><b>Caddy</b></summary>

```caddy
example.com {
    handle_path /s3/* {
        reverse_proxy 127.0.0.1:47715
    }
}
```

`handle_path` strips `/s3`, so start s3deck **without** `--base-path` here.

</details>

### Health check

`GET /healthz` returns `{"ok":true}` without logging in.

## Security

> [!WARNING]
> s3deck gives anyone who logs in everything the access key can do. Treat it
> like the key itself.

- **Keys never reach the browser.** The server signs every S3 request. The UI
  only ever receives object data and presigned links you create on purpose.
- **Login.** On by default, with a random password printed at startup. Sessions
  are HTTP-only, `SameSite=Strict` cookies kept in memory. Restarting s3deck
  logs everyone out. Failed logins are rate-limited per client address.
- **Roles.** Every request is checked against the user's current role, so
  changing someone's role or disabling them takes effect immediately. Passwords
  are stored as scrypt hashes.
- **Stored secrets.** Remembered connections are encrypted with AES-256-GCM.
  All files in the data directory are created owner-only (`0600`).
- **Single sign-on.** Authorization code flow with PKCE, state and nonce checks;
  unverified email addresses are refused.
- **Network.** Binds to `127.0.0.1` unless you pass `--host`. s3deck warns at
  startup if you combine a public interface with `--no-auth`.
- **CSRF.** API calls require a custom header, so other websites can't use your
  session.
- **Previews.** HTML and SVG files are never rendered as pages. They are shown
  as source or in a sandboxed frame, so a file in a bucket can't run scripts
  in s3deck.
- **HTTPS.** s3deck serves plain HTTP. Terminate TLS at your reverse proxy; the
  session cookie is marked `Secure` when the proxy sends
  `X-Forwarded-Proto: https`.
- **Least privilege.** For anything sensitive, use a key scoped to the buckets
  and actions you need. `--readonly` blocks writes in s3deck, but the real
  boundary is the key's IAM policy. A read-only key is the safest choice.

Found a vulnerability? Please report it privately through
[GitHub security advisories](https://github.com/kamdev-choudhary/decktools/security/advisories/new)
rather than a public issue.

## Troubleshooting

| Symptom                                                   | Likely cause and fix                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AccessDenied` when listing buckets                       | The key can't call `ListBuckets`. Pass the buckets it can reach with `--bucket <name>` (repeat for several).  |
| `SignatureDoesNotMatch` or `AuthorizationHeaderMalformed` | Wrong region. Set `--region` (R2 uses `auto`).                                                                |
| Bucket not found / DNS errors on self-hosted storage      | The server needs path-style URLs. Add `--path-style`.                                                         |
| Uploads fail or stall behind a proxy                      | The proxy is limiting or buffering bodies. See [Behind a reverse proxy](#behind-a-reverse-proxy).             |
| Logged out after restarting                               | Expected: sessions live in memory. Set `--password` / `S3DECK_PASSWORD` to keep the same login.               |
| Remembered connections are gone                           | The data directory or its `secret.key` changed. Keep `S3DECK_SECRET` or the key file with the data directory. |

## Development

s3deck lives in the [decktools](https://github.com/kamdev-choudhary/decktools) monorepo, under
`tools/s3deck`.

```bash
git clone https://github.com/kamdev-choudhary/decktools.git
cd decktools
pnpm install
cd tools/s3deck

# Optional: a local MinIO to develop against
docker run -d -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address :9001

# API on :47715 (no login) + Vite UI with hot reload on :47716
AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
AWS_ENDPOINT_URL=http://localhost:9000 pnpm dev
```

Open <http://localhost:47716>.

| Script                  | What it does                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm dev`              | API with auto-restart and the UI with hot reload                                             |
| `pnpm build`            | Build the UI (Vite) and the CLI (tsdown) into `dist/`                                        |
| `pnpm start`            | Run the built CLI                                                                            |
| `pnpm typecheck`        | Type-check the server, the UI and the tests                                                  |
| `pnpm lint`             | Lint with oxlint                                                                             |
| `pnpm test`             | Unit and API tests (Vitest). Add `S3DECK_TEST_ENDPOINT` to also run the S3 integration tests |
| `pnpm test:integration` | Integration tests against `http://localhost:9000` (or `$S3DECK_TEST_ENDPOINT`)               |
| `pnpm pack:check`       | Build and list exactly what would be published                                               |

### Project layout

```
src/
  cli/        command-line entry, options, credential resolution, startup banner
  server/     Hono app: auth, roles, API routes, SSO, jobs, static UI
    store/    data directory: users, encrypted connections, activity log
  s3/         S3 client, provider detection, listing, transfers, multipart, sync
  shared/     zod schemas and types shared by the server and the UI
test/
  unit/         schemas, providers, crypto, users, API (no S3 needed)
  integration/  real S3: uploads, multipart, copy, presign, sync
web/
  src/
    api/          typed API client, React Query hooks
    components/   shadcn/ui primitives (ui/) and app components (app/)
    views/        buckets, object browser, preview, bucket settings, sync, activity, users, login
    lib/          router, theme, formatting, resumable upload queue
```

### Built with

[![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white)](https://hono.dev)
[![AWS SDK v3](https://img.shields.io/badge/AWS_SDK-v3-232F3E?style=flat-square&logo=amazonwebservices&logoColor=white)](https://github.com/aws/aws-sdk-js-v3)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![TanStack Query](https://img.shields.io/badge/TanStack_Query-FF4154?style=flat-square&logo=reactquery&logoColor=white)](https://tanstack.com/query)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000000?style=flat-square&logo=shadcnui&logoColor=white)](https://ui.shadcn.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![tsdown](https://img.shields.io/badge/tsdown-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://tsdown.dev)

## Contributing

Contributions are welcome! Bug reports and feature requests go in
[issues](https://github.com/kamdev-choudhary/decktools/issues). For code changes:

1. Fork the repo and create a branch from `main`.
2. Run `pnpm dev` against a local MinIO (see [Development](#development)) and
   make your change.
3. Make sure `pnpm check` passes at the repository root (lint, typecheck, tests, build).
4. Open a pull request describing what changed and why.

## License

Released under the [MIT License](./LICENSE).
