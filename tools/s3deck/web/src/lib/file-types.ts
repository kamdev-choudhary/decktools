import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon,
} from 'lucide-react';

export type PreviewKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'code'
  | 'text'
  // Rich previews (lazy-loaded, see views/rich-previews.tsx)
  | 'svg'
  | 'html'
  | 'font'
  | 'spreadsheet'
  | 'docx'
  | 'parquet'
  | 'zip'
  | 'none';

/** Kinds handled by the lazily loaded rich preview module. */
export const RICH_KINDS = new Set<PreviewKind>(['svg', 'html', 'font', 'spreadsheet', 'docx', 'parquet', 'zip']);

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'gif', 'webp', 'avif', 'apng', 'bmp', 'ico', 'cur']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);
const ARCHIVE = new Set(['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'zst']);
const TEXT = new Set([
  'txt',
  'text',
  'log',
  'out',
  'err',
  'env',
  'cfg',
  'conf',
  'properties',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'npmrc',
  'nvmrc',
  'lock',
  'pem',
  'crt',
  'cer',
  'csr',
  'pub',
  'srt',
  'vtt',
  'rst',
  'adoc',
  'tex',
  'bib',
  'license',
]);
/** ZIP-format archives; only their file listing is read. */
const ZIP = new Set(['zip', 'jar', 'war', 'ear', 'whl', 'apk', 'aab', 'ipa', 'nupkg', 'vsix', 'xpi', 'crx']);
const FONT = new Set(['ttf', 'otf', 'woff', 'woff2']);

/** File extension → highlight.js language. */
export const CODE_LANGS: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  tf: 'ini',
  lua: 'lua',
  r: 'r',
  md: 'markdown',
  markdown: 'markdown',
  kts: 'kotlin',
  scala: 'scala',
  groovy: 'groovy',
  gradle: 'groovy',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  fs: 'fsharp',
  ml: 'ocaml',
  jl: 'julia',
  zig: 'zig',
  nim: 'nim',
  pl: 'perl',
  pm: 'perl',
  m: 'objectivec',
  mm: 'objectivec',
  vb: 'vbnet',
  asm: 'x86asm',
  s: 'x86asm',
  fish: 'bash',
  bat: 'dos',
  cmd: 'dos',
  psm1: 'powershell',
  awk: 'awk',
  mk: 'makefile',
  cmake: 'cmake',
  diff: 'diff',
  patch: 'diff',
  proto: 'protobuf',
  thrift: 'thrift',
  hcl: 'ini',
  tfvars: 'ini',
  nix: 'nix',
  prisma: 'graphql',
  svelte: 'xml',
  astro: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  plist: 'xml',
  csproj: 'xml',
  wsdl: 'xml',
  rss: 'xml',
  atom: 'xml',
  gpx: 'xml',
  kml: 'xml',
  sass: 'scss',
  styl: 'css',
  ipynb: 'json',
  jsonc: 'json',
  json5: 'json',
  webmanifest: 'json',
  har: 'json',
  sol: 'javascript',
  wat: 'wasm',
  cue: 'yaml',
  mdx: 'markdown',
};

/** Extensionless files recognised by name. */
const NAMED: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  jenkinsfile: 'groovy',
  vagrantfile: 'ruby',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  procfile: 'bash',
  brewfile: 'ruby',
  caddyfile: 'ini',
  justfile: 'makefile',
};

export function previewKind(name: string, contentType?: string | null): PreviewKind {
  const e = ext(name);
  const t = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  const lower = name.toLowerCase();
  if (e === 'svg' || e === 'svgz' || t.includes('svg')) return 'svg'; // rendered via <img>, never inline
  if (e === 'html' || e === 'htm' || e === 'xhtml' || t === 'text/html') return 'html';
  if (FONT.has(e) || t.startsWith('font/')) return 'font';
  if (e === 'xlsx' || e === 'xlsm' || t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return 'spreadsheet';
  if (e === 'docx' || t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (e === 'parquet' || e === 'parq') return 'parquet';
  if (ZIP.has(e) || t === 'application/zip') return 'zip';
  if (IMAGE.has(e) || t.startsWith('image/')) return 'image';
  if (VIDEO.has(e) || t.startsWith('video/')) return 'video';
  if (AUDIO.has(e) || t.startsWith('audio/')) return 'audio';
  if (e === 'pdf' || t === 'application/pdf') return 'pdf';
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (
    e === 'json' ||
    e === 'jsonl' ||
    e === 'ndjson' ||
    e === 'geojson' ||
    e === 'topojson' ||
    t === 'application/json'
  )
    return 'json';
  if (e === 'csv' || e === 'tsv' || e === 'psv' || t === 'text/csv' || t === 'text/tab-separated-values') return 'csv';
  if (CODE_LANGS[e] || NAMED[lower] || lower.startsWith('dockerfile.')) return 'code';
  if (TEXT.has(e) || t.startsWith('text/')) return 'text';
  return 'none';
}

export function languageFor(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (NAMED[lower]) return NAMED[lower];
  if (lower.startsWith('dockerfile.')) return 'dockerfile';
  return CODE_LANGS[ext(name)];
}

export function iconFor(name: string): LucideIcon {
  const e = ext(name);
  if (ARCHIVE.has(e) || ZIP.has(e)) return FileArchive;
  if (e === 'csv' || e === 'tsv' || e === 'xlsx' || e === 'xlsm' || e === 'xls' || e === 'ods' || e === 'parquet')
    return FileSpreadsheet;
  switch (previewKind(name)) {
    case 'image':
    case 'svg':
      return FileImage;
    case 'font':
      return FileType;
    case 'video':
      return FilePlay;
    case 'audio':
      return FileMusic;
    case 'code':
    case 'json':
    case 'html':
      return FileCode;
    case 'docx':
    case 'pdf':
    case 'markdown':
    case 'text':
      return FileText;
    default:
      return File;
  }
}
