import { hl } from '../../components/deck/types';
import type { DeployContent, Feature, HeroContent, TourStop } from '../../components/deck/types';

const { comment: c, keyword: k, flag: v, string: q } = hl;

export const SECTIONS = [
  ['#features', 'Features'],
  ['#tour', 'Tour'],
  ['#deploy', 'Deploy'],
] as const;

export const hero = (version: string): HeroContent => ({
  release: 'Preview, share and sync on any S3 provider',
  title: 'The S3 browser that starts with one command.',
  lede: 'Browse buckets, preview files, move gigabytes, share links and manage bucket settings on AWS S3, Cloudflare R2, MinIO, Backblaze B2 and more, all from your browser.',
  command: 'npx s3deck --profile prod --open',
  footnote: 'Free and open source, MIT licensed. Needs Node.js 20 or newer.',
  terminalCommand: 'npx s3deck http://localhost:9000',
  terminalCwd: '~/assets',
  terminal: [
    { gap: true, html: `  <span class="font-semibold text-blue">s3deck</span> <span class="text-faint">v${version}</span>` },
    { gap: true, html: `  <span class="text-green">✓ Connected</span>   MinIO <span class="text-faint">(region us-east-1)</span>` },
    { html: `    <span class="text-faint">Buckets</span>     8 available` },
    { html: `  <span class="text-blue">➜ Web UI      http://127.0.0.1:47715/</span>` },
    { html: `    <span class="text-faint">Login</span>       admin / <span class="text-amber">3fH9kQ2xLmP_</span>` },
  ],
  host: 'files.example.com',
  shot: {
    name: 'grid',
    alt: 'The s3deck grid view of the acme-assets images folder: thumbnail cards for twelve landscape images and a brand folder, each with its size.',
  },
  stats: [
    ['Any S3 API', 'AWS, R2, MinIO, B2, Spaces, Wasabi'],
    ['Millions of objects', 'listed page by page as you scroll'],
    ['Keys stay server-side', 'every request is signed on the server'],
    ['1 command', 'no Docker, no CORS rules, no account'],
  ],
});

export const features: Feature[] = [
  { icon: 'folder', title: 'Folders that feel like folders', body: 'Breadcrumbs, sorting by name, size, date or storage class, filtering as you type, and search by prefix across the bucket.' },
  { icon: 'eye', title: 'Previews in a side panel', body: 'Images, video, audio, PDF, code with highlighting, formatted JSON, CSV as a table and Markdown. Large files preview from their first bytes.' },
  { icon: 'upload', title: 'Uploads that resume', body: 'Drag files or whole folders. Big files go up in parallel parts with pause and cancel, and continue where they stopped.' },
  { icon: 'backup', title: 'Downloads of any size', body: 'Files stream straight from storage. Select several, or a folder, and get one ZIP built on the fly.' },
  { icon: 'sync', title: 'Copy, move and sync', body: 'Server-side copy inside or between buckets, drag to move, and compare two folders, even R2 → S3, then mirror them.' },
  { icon: 'link', title: 'Links to share', body: 'Presigned download links from minutes to 7 days, upload links for one key, and public URLs for public buckets.' },
  { icon: 'history', title: 'Versions and undelete', body: 'List an object’s versions, restore an older one, and bring back deleted files on versioned buckets.' },
  { icon: 'settings', title: 'Bucket settings', body: 'Versioning, CORS, lifecycle rules, bucket policy and public access, each in a JSON editor that validates before saving.' },
  { icon: 'archive', title: 'Storage classes and Glacier', body: 'Move objects between classes, restore archived ones, and clean up incomplete multipart uploads you’re still billed for.' },
  { icon: 'chart', title: 'Storage usage', body: 'Size and object count of a bucket or folder, broken down by subfolder and storage class, on demand.' },
  { icon: 'users', title: 'Users, roles and SSO', body: 'Viewers, editors and admins with their own login, or sign-in with Google, Microsoft, Okta or any OpenID Connect provider.' },
  { icon: 'keys', title: 'Fast from the keyboard', body: '⌘K to switch buckets, Space to preview, ⌘U to upload, / to filter, and arrow keys to move between rows.' },
];

export const tour: TourStop[] = [
  { id: 'browse', shot: 'browse', label: 'Browse', body: 'Every bucket in the sidebar, folders with breadcrumbs, and columns for size, date and storage class.', alt: 'The acme-assets images folder: a brand folder and twelve JPEG files with sizes, last-modified times and the STANDARD storage class.' },
  { id: 'preview', shot: 'preview', label: 'Preview', body: 'Press Space on a file to preview it in a side panel, with its details, versions and tags one tab away.', alt: 'The preview panel open on mountain-trail.jpg, showing the image with Details, Versions and Tags tabs.' },
  { id: 'csv', shot: 'preview-csv', label: 'Data files', body: 'CSV opens as a table, JSON is formatted and code is highlighted, without downloading anything.', alt: 'The preview panel showing orders-2026-10.csv as a table of order ids, customers, countries, statuses, totals and dates.' },
  { id: 'versions', shot: 'versions', label: 'Versions', body: 'On versioned buckets, every version of an object: preview, download or restore any of them.', alt: 'The Versions tab for hero-banner.jpg: five versions with dates, version IDs and sizes, the newest marked current.' },
  { id: 'share', shot: 'share', label: 'Share', body: 'Presigned download links with an expiry from minutes to 7 days, upload links, or the public URL.', alt: 'The Share dialog for hero-banner.jpg with Download link, Upload link and Public URL tabs and an expiry menu.' },
  { id: 'settings', shot: 'settings', label: 'Settings', body: 'Versioning, CORS, lifecycle, bucket policy and encryption at a glance, each a click from its editor.', alt: 'The acme-assets settings: region, provider, default encryption, object lock, versioning, CORS and lifecycle rules, and a Delete bucket card.' },
  { id: 'usage', shot: 'usage', label: 'Usage', body: 'Calculate the size and object count of a bucket or folder, broken down by subfolder and storage class.', alt: 'Storage usage for acme-assets: 36.2 MB in 34 objects, with a bar for each folder and for the STANDARD storage class.' },
];

export const deploy: DeployContent = {
  title: 'Run it next to your storage.',
  lede: 'On your laptop with your usual AWS profile. On a server behind a reverse proxy with HTTPS for your team. Uploads and downloads stream straight through, so file size doesn’t matter.',
  flags: [
    ['--readonly', 'No uploads, edits or deletes'],
    ['--bucket <name>', 'Open buckets a key can’t list'],
    ['--profile <name>', 'Use an AWS profile, SSO included'],
    ['--base-path /s3', 'Serve under a path prefix'],
    ['--path-style', 'For gateways that need host/bucket/key'],
  ],
  snippets: [
    {
      id: 'examples',
      label: 'Terminal',
      html: [
        c('# AWS with a named profile, opens your browser'),
        `npx s3deck ${v('--profile')} prod ${v('--open')}`,
        '',
        c('# Local MinIO with its default credentials'),
        `AWS_ACCESS_KEY_ID=${q('minioadmin')} AWS_SECRET_ACCESS_KEY=${q('minioadmin')} \\`,
        `  npx s3deck ${q('http://localhost:9000')}`,
        '',
        c('# Cloudflare R2, read-only'),
        `npx s3deck ${q('"https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"')} ${v('--region')} auto ${v('--readonly')}`,
      ].join('\n'),
    },
    {
      id: 'nginx',
      label: 'nginx',
      html: [
        c('# npx s3deck --base-path /s3 --password "$SECRET"'),
        `${k('location')} /s3/ {`,
        `    ${k('proxy_pass')} http://127.0.0.1:47715;`,
        `    ${k('proxy_http_version')} 1.1;`,
        `    ${k('proxy_set_header')} Host $host;`,
        `    ${k('proxy_set_header')} X-Forwarded-For $proxy_add_x_forwarded_for;`,
        `    ${k('proxy_set_header')} X-Forwarded-Proto $scheme;`,
        '',
        `    ${c('# Large transfers: no body limit, stream both ways')}`,
        `    ${k('client_max_body_size')} 0;`,
        `    ${k('proxy_request_buffering')} off;`,
        `    ${k('proxy_buffering')} off;`,
        `    ${k('proxy_read_timeout')} 1h;`,
        `    ${k('proxy_send_timeout')} 1h;`,
        '}',
      ].join('\n'),
    },
    {
      id: 'caddy',
      label: 'Caddy',
      html: [
        c('# handle_path strips /s3, so start s3deck without --base-path'),
        `example.com {`,
        `    ${k('handle_path')} /s3/* {`,
        `        ${k('reverse_proxy')} 127.0.0.1:47715`,
        '    }',
        '}',
      ].join('\n'),
    },
    {
      id: 'sso',
      label: 'Single sign-on',
      html: [
        c('# Any OpenID Connect provider. Redirect URL: <s3deck>/api/auth/sso/callback'),
        `S3DECK_OIDC_ISSUER=${q('https://accounts.google.com')} \\`,
        `S3DECK_OIDC_CLIENT_ID=… S3DECK_OIDC_CLIENT_SECRET=… \\`,
        `S3DECK_OIDC_ALLOW=${q('"@example.com"')} \\`,
        `S3DECK_OIDC_DEFAULT_ROLE=${q('viewer')} \\`,
        `S3DECK_PUBLIC_URL=${q('https://files.example.com')} \\`,
        `npx s3deck`,
      ].join('\n'),
    },
  ],
  safety: [
    ['Keys never reach the browser', 'The server signs every S3 request. The UI only sees object data and links you create.'],
    ['Login by default', 'A random password at every start, HTTP-only SameSite=Strict cookies, and rate-limited sign-in.'],
    ['Roles checked every request', 'Change someone’s role or disable them and it applies at once. Passwords are scrypt hashes.'],
    ['Least privilege', 'Anyone who logs in can do what the key can. Scope it to the buckets and actions you need.'],
  ],
};
