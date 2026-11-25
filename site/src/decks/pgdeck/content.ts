import { hl } from '../../components/deck/types';
import type { DeployContent, HeroContent, TourStop } from '../../components/deck/types';

const { comment: c, keyword: k, flag: v, string: q } = hl;

export const SECTIONS = [
  ['#how', 'How it works'],
  ['#features', 'Features'],
  ['#tour', 'Tour'],
  ['#deploy', 'Deploy'],
] as const;

export const hero = (version: string): HeroContent => ({
  release: 'Tables, columns and indexes, right in the UI',
  title: 'The Postgres admin that starts with one command.',
  lede: 'Browse and edit rows, run SQL, change tables and watch live activity on every database on your server. pgdeck runs wherever Node does and opens in any browser.',
  command: 'npx pgdeck postgres://user:pass@host:5432/db',
  footnote: 'Free and open source, MIT licensed. Needs Node.js 20 or newer.',
  terminalCommand: 'npx pgdeck postgres://localhost:5432/shop',
  terminalCwd: '~/shop',
  terminal: [
    {
      gap: true,
      html: `  <span class="font-semibold text-blue">pgdeck</span> <span class="text-faint">v${version}</span>`,
    },
    {
      gap: true,
      html: `  <span class="text-green">✓ Connected</span>   shop as postgres <span class="text-faint">(PostgreSQL 18)</span>`,
    },
    { html: `    <span class="text-faint">Databases</span>   35 available` },
    { html: `  <span class="text-blue">➜ Web UI      http://127.0.0.1:47615/</span>` },
    { html: `    <span class="text-faint">Login</span>       admin / <span class="text-amber">7Qm2xLpR9vKe</span>` },
  ],
  host: 'db.example.com',
  shot: {
    name: 'overview',
    alt: 'The pgdeck overview: connections, transactions and cache stats, live charts of transactions and rows per second, and the active sessions on the shop database.',
  },
  stats: [
    ['1M rows', 'imported from CSV in about 3 s'],
    ['1 command', 'no install, no config, no account'],
    ['7 formats', 'to export, plus SQL backups'],
    ['PostgreSQL 12+', 'local, in Docker or managed'],
  ],
});

export const tour: TourStop[] = [
  {
    id: 'browse',
    shot: 'table',
    label: 'Browse',
    body: 'Sort, page and filter millions of rows. Headers show each type and where its foreign key points.',
    alt: 'The orders table: order ids, customer UUIDs linking to customers, statuses, totals and timestamps, with filters and pagination.',
  },
  {
    id: 'edit',
    shot: 'editor',
    label: 'Edit',
    body: 'Double-click a row for a form with the right control for each column, including a picker for foreign keys.',
    alt: 'The Edit row dialog for an order, with a foreign key Browse button, a status menu and date pickers.',
  },
  {
    id: 'sql',
    shot: 'sql',
    label: 'SQL',
    body: 'Highlighting and table autocomplete. Run the selection or the whole script, keep history, export results.',
    alt: 'The SQL editor with a revenue-by-country query and its result rows.',
  },
  {
    id: 'structure',
    shot: 'structure',
    label: 'Structure',
    body: 'Columns, indexes, constraints and references, each with actions to change or drop it.',
    alt: 'The Structure tab for orders with columns, indexes and constraints.',
  },
  {
    id: 'create',
    shot: 'create-table',
    label: 'Create',
    body: 'Build a table column by column, with constraints and foreign keys, and read the SQL as you go.',
    alt: 'The New table dialog with columns, constraint toggles and a references picker.',
  },
  {
    id: 'import',
    shot: 'import',
    label: 'Import',
    body: 'Drop data files or a pg_dump backup. Files are matched to tables by name and streamed in.',
    alt: 'The Import page with drop zones for data files and backups.',
  },
  {
    id: 'export',
    shot: 'export',
    label: 'Export',
    body: 'Pick tables and a format, or download the whole database as a restorable backup.',
    alt: 'The Export page with a table list and format options.',
  },
];

export const deploy: DeployContent = {
  title: 'Run it next to your database.',
  lede: 'On your laptop for local work. On a server behind an SSH tunnel or a reverse proxy with HTTPS for everything else. It works at the root of a domain or under a path.',
  flags: [
    ['--readonly', 'Read-only sessions, no editing'],
    ['--password', 'A fixed login instead of a random one'],
    ['--host 0.0.0.0', 'Listen beyond localhost'],
    ['--base-path /db', 'Serve under a path prefix'],
    ['--ssl', 'SSL without certificate checks'],
  ],
  snippets: [
    {
      id: 'examples',
      label: 'Terminal',
      html: [
        c('# Local database, opens your browser'),
        `npx pgdeck ${q('postgres://postgres@localhost:5432')} ${v('--open')}`,
        '',
        c('# Production, read-only, with a fixed password'),
        `PGDECK_PASSWORD=${q("'correct horse battery staple'")} \\`,
        `  npx pgdeck ${q('"$DATABASE_URL"')} ${v('--readonly')}`,
        '',
        c('# Managed Postgres that requires SSL'),
        `npx pgdeck ${q('"postgres://user:pass@db.example.com/app?sslmode=require"')}`,
      ].join('\n'),
    },
    {
      id: 'tunnel',
      label: 'SSH tunnel',
      html: [
        c('# On the server: pgdeck stays private on 127.0.0.1'),
        `npx pgdeck ${q('postgres://postgres@localhost:5432')} ${v('--password')} ${q('"$SECRET"')}`,
        '',
        c('# On your laptop: forward the port, then open http://127.0.0.1:47615'),
        `ssh ${v('-L')} 47615:127.0.0.1:47615 you@your-server`,
      ].join('\n'),
    },
    {
      id: 'nginx',
      label: 'nginx',
      html: [
        c('# npx pgdeck "$DATABASE_URL" --base-path /db --password "$SECRET"'),
        `${k('location')} /db/ {`,
        `    ${k('proxy_pass')} http://127.0.0.1:47615;`,
        `    ${k('proxy_http_version')} 1.1;`,
        `    ${k('proxy_set_header')} Upgrade $http_upgrade;`,
        `    ${k('proxy_set_header')} Connection ${q('"upgrade"')};`,
        `    ${k('proxy_set_header')} Host $host;`,
        `    ${k('proxy_set_header')} X-Forwarded-Proto $scheme;`,
        '',
        `    ${c('# Large imports: stream uploads, no size limit')}`,
        `    ${k('client_max_body_size')} 0;`,
        `    ${k('proxy_request_buffering')} off;`,
        `    ${k('proxy_read_timeout')} 1h;`,
        '}',
      ].join('\n'),
    },
    {
      id: 'caddy',
      label: 'Caddy',
      html: [
        c('# handle_path strips /db, so start pgdeck without --base-path'),
        `example.com {`,
        `    ${k('handle_path')} /db/* {`,
        `        ${k('reverse_proxy')} 127.0.0.1:47615`,
        '    }',
        '}',
      ].join('\n'),
    },
  ],
  safety: [
    [
      'Login by default',
      'A random password at every start, HTTP-only SameSite=Strict cookies, and rate-limited sign-in.',
    ],
    ['Private unless you say so', 'Binds to 127.0.0.1. It warns if you expose it without a login.'],
    ['Cross-site safe', 'API calls need a custom header and WebSockets check their Origin.'],
    ['Least privilege', 'pgdeck can only do what its role can. Use a read-only role for anything sensitive.'],
  ],
};
