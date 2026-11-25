import { hl } from '../../components/deck/types';
import type { DeployContent, Feature, HeroContent, TourStop } from '../../components/deck/types';

const { comment: c, keyword: k, flag: v, string: q } = hl;

export const SECTIONS = [
  ['#features', 'Features'],
  ['#tour', 'Tour'],
  ['#deploy', 'Deploy'],
] as const;

export const hero = (version: string): HeroContent => ({
  release: 'Keys of every type, a console and live stats',
  title: 'The Redis browser that starts with one command.',
  lede: 'Browse and edit keys of every type, run commands in a console, and watch live server stats. redisdeck runs wherever Node does and opens in any browser.',
  command: 'npx redisdeck redis://:password@host:6379',
  footnote: 'Free and open source, MIT licensed. Needs Node.js 20 or newer.',
  terminalCommand: 'npx redisdeck redis://localhost:6379',
  terminalCwd: '~/shop',
  terminal: [
    { gap: true, html: `  <span class="font-semibold text-blue">redisdeck</span> <span class="text-faint">v${version}</span>` },
    { gap: true, html: `  <span class="text-green">✓ Connected</span>   localhost:6379 <span class="text-faint">(Redis 8.10, master)</span>` },
    { html: `    <span class="text-faint">Keys</span>        546 in 3 databases` },
    { html: `  <span class="text-blue">➜ Web UI      http://127.0.0.1:47815/</span>` },
    { html: `    <span class="text-faint">Login</span>       admin / <span class="text-amber">Xr4vQ8mLe2Tk</span>` },
  ],
  host: 'cache.example.com',
  shot: {
    name: 'keys',
    alt: 'The redisdeck key browser: user hashes filtered by the pattern user:10[3-5]*, with user:1042 open showing its name, email, plan, city and order count.',
  },
  stats: [
    ['SCAN, not KEYS', 'safe to browse a busy server'],
    ['7 data types', 'each with its own editor'],
    ['1 command', 'no install, no config, no account'],
    ['rediss://', 'TLS, passwords and ACL users'],
  ],
});

export const features: Feature[] = [
  { icon: 'search', title: 'Find any key', body: 'Search by text or a glob pattern like user:*, and filter by type. Listing uses SCAN, so it never blocks the server.' },
  { icon: 'clock', title: 'TTL at a glance', body: 'Every key shows its type and time to live. Set or remove an expiry without typing a command.' },
  { icon: 'actions', title: 'Key actions', body: 'Create keys of any type, rename them (never overwriting another), and delete.' },
  { icon: 'terminal', title: 'A console that feels like redis-cli', body: 'Run any command with Tab completion, output shaped like redis-cli, exact integers and ↑/↓ history.' },
  { icon: 'chart', title: 'Live server stats', body: 'Operations per second, memory, network and clients, cache hit ratio, keyspace per database and the slow log.' },
  { icon: 'layers', title: 'Every logical database', body: 'Switch between db0 and db15, or however many the server has, from the header.' },
  { icon: 'binary', title: 'Binary safe', body: 'Keys and values that aren’t UTF-8 are shown escaped (\\xff) and never corrupted by an edit.' },
  { icon: 'lock', title: 'Read-only that holds', body: 'With --readonly the console only runs commands Redis itself flags as read-only, using COMMAND INFO.' },
  { icon: 'theme', title: 'Light and dark', body: 'Follows your system, or pick one. Type badges and charts are tuned for both.' },
];

export const tour: TourStop[] = [
  { id: 'hash', shot: 'keys', label: 'Hashes', body: 'Filter keys by pattern and open one: every field of a hash in a table you can edit in place.', alt: 'The key browser filtered to user:10[3-5]*, with the user:1042 hash open: name, email, plan, city, created_at and orders fields.' },
  { id: 'zset', shot: 'sorted-set', label: 'Sorted sets', body: 'Members ranked by score, with length, memory and encoding up top. Add, rescore and remove members.', alt: 'The leaderboard:weekly sorted set: 78 members listed by rank with their scores.' },
  { id: 'stream', shot: 'stream', label: 'Streams', body: 'Newest entries first, each with its ID and fields. Add entries straight from the UI.', alt: 'The events:orders stream: entries with order_id, user_id, total and status fields, newest first.' },
  { id: 'string', shot: 'string', label: 'Strings', body: 'Strings that look like JSON can be formatted for editing, then saved back exactly.', alt: 'The config:feature-flags string, formatted as JSON with new_checkout, search_v2, dark_mode and max_cart_items.' },
  { id: 'console', shot: 'console', label: 'Console', body: 'Run any command against the current database. Replies look the way redis-cli prints them.', alt: 'The console after HGETALL user:1042, ZREVRANGE leaderboard:weekly 0 4 WITHSCORES and INFO keyspace, with their replies.' },
  { id: 'server', shot: 'server', label: 'Server', body: 'Live operations per second, network and memory, with clients and cache hit ratio at the top.', alt: 'The Server page: about 23,000 operations per second, 1.8 MB memory, 5 clients, a 100% cache hit ratio, and live charts.' },
];

export const deploy: DeployContent = {
  title: 'Run it next to your Redis.',
  lede: 'On your laptop for a local Redis. On a server behind an SSH tunnel or a reverse proxy for everything else. It works at the root of a domain or under a path.',
  flags: [
    ['--readonly', 'Refuse every edit and write command'],
    ['--password', 'A fixed login instead of a random one'],
    ['--host 0.0.0.0', 'Listen beyond localhost'],
    ['--base-path /redis', 'Serve under a path prefix'],
    ['--tls-insecure', 'rediss:// without certificate checks'],
  ],
  snippets: [
    {
      id: 'examples',
      label: 'Terminal',
      html: [
        c('# Local Redis on the default port, opens your browser'),
        `npx redisdeck ${v('--open')}`,
        '',
        c('# With a password, opening database 2'),
        `npx redisdeck ${q('redis://:secret@localhost:6379/2')}`,
        '',
        c('# Managed Redis over TLS, read-only'),
        `npx redisdeck ${q('rediss://default:secret@cache.example.com:6380')} ${v('--readonly')}`,
      ].join('\n'),
    },
    {
      id: 'tunnel',
      label: 'SSH tunnel',
      html: [
        c('# On the server: redisdeck stays private on 127.0.0.1'),
        `npx redisdeck ${q('"$REDIS_URL"')} ${v('--password')} ${q('"$SECRET"')}`,
        '',
        c('# On your laptop: forward the port, then open http://127.0.0.1:47815'),
        `ssh ${v('-L')} 47815:127.0.0.1:47815 you@your-server`,
      ].join('\n'),
    },
    {
      id: 'nginx',
      label: 'nginx',
      html: [
        c('# npx redisdeck "$REDIS_URL" --base-path /redis --password "$SECRET"'),
        `${k('location')} /redis/ {`,
        `    ${k('proxy_pass')} http://127.0.0.1:47815;`,
        `    ${k('proxy_set_header')} Host $host;`,
        `    ${k('proxy_set_header')} X-Forwarded-For $proxy_add_x_forwarded_for;`,
        `    ${k('proxy_set_header')} X-Forwarded-Proto $scheme;`,
        '}',
      ].join('\n'),
    },
    {
      id: 'caddy',
      label: 'Caddy',
      html: [
        c('# handle_path strips /redis, so start redisdeck without --base-path'),
        `example.com {`,
        `    ${k('handle_path')} /redis/* {`,
        `        ${k('reverse_proxy')} 127.0.0.1:47815`,
        '    }',
        '}',
      ].join('\n'),
    },
  ],
  safety: [
    ['Login by default', 'A random password at every start, HTTP-only SameSite=Strict sessions, and rate-limited sign-in.'],
    ['Private unless you say so', 'Binds to 127.0.0.1. Reach it through an SSH tunnel or a reverse proxy.'],
    ['Cross-site safe', 'Every API call needs a custom header, so other sites can’t act on your behalf.'],
    ['Least privilege', 'redisdeck can only do what its user can. Connect as a read-only ACL user for anything sensitive.'],
  ],
};
