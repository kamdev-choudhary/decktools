import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { RestoreResponse } from '../shared/export.js';
import type { DbContext } from './client.js';
import { UserError } from './errors.js';

export interface RestoreOptions {
  gzip: boolean;
  /** pg_dump custom format (PGDMP…): converted to SQL with pg_restore first. */
  custom: boolean;
  /** Wrap the whole restore in one transaction (like psql --single-transaction). */
  singleTransaction: boolean;
  /** Skip OWNER TO / GRANT / REVOKE, which fail when the dump's roles don't exist here. */
  skipOwnership: boolean;
}

type Event =
  | { type: 'stmt'; sql: string; line: number }
  | { type: 'copy'; sql: string; line: number }
  | { type: 'data'; text: string }
  | { type: 'end-copy' };

const COPY_FROM_STDIN = /^\s*copy\b[\s\S]*\bfrom\s+stdin\b/i;
const OWNERSHIP =
  /^\s*(alter\s+[\s\S]*\bowner\s+to\b|grant\b|revoke\b|alter\s+default\s+privileges\b|security\s+label\b|comment\s+on\s+extension\b)/i;
const SETTING = /^\s*(set\b|select\s+pg_catalog\.set_config\b)/i;

/** Statement text without leading whitespace and comments, for classifying it. */
function stripLeadingComments(sql: string): string {
  let s = sql;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n');
      s = nl === -1 ? '' : t.slice(nl + 1);
    } else if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      s = end === -1 ? '' : t.slice(end + 2);
    } else return t;
  }
}

/**
 * Incremental scanner for psql-style scripts. Splits on semicolons outside
 * quotes, dollar-quotes and comments; skips psql meta-commands (\connect,
 * \restrict …); passes COPY … FROM stdin data through until "\.".
 */
class ScriptScanner {
  private buf = '';
  private pos = 0;
  private stmtStart = 0;
  private line = 1;
  private stmtLine = 1;
  private mode:
    | 'normal'
    | 'single'
    | 'escape-single'
    | 'double'
    | 'dollar'
    | 'line-comment'
    | 'block-comment'
    | 'copy-eol'
    | 'copy' = 'normal';
  /** Nothing but whitespace/comments since the last statement ended. */
  private blank = true;
  private dollarTag = '';
  private blockDepth = 0;

  push(text: string, final: boolean): Event[] {
    this.buf += text;
    const events: Event[] = [];
    const b = () => this.buf;

    while (this.pos < b().length) {
      const s = b();
      const ch = s[this.pos]!;

      if (this.mode === 'copy-eol') {
        // Rest of the "COPY … FROM stdin;" line; data starts after it.
        const nl = s.indexOf('\n', this.pos);
        if (nl === -1) {
          if (!final) break;
          this.pos = s.length;
        } else {
          this.pos = nl + 1;
          this.line++;
          this.mode = 'copy';
        }
        continue;
      }

      if (this.mode === 'copy') {
        const nl = s.indexOf('\n', this.pos);
        if (nl === -1 && !final) break; // wait for a full line
        const end = nl === -1 ? s.length : nl + 1;
        const lineText = s.slice(this.pos, end);
        this.line++;
        if (lineText.replace(/\r?\n$/, '') === '\\.') {
          events.push({ type: 'end-copy' });
          this.mode = 'normal';
          this.stmtStart = end;
          this.stmtLine = this.line;
          this.blank = true;
        } else {
          events.push({ type: 'data', text: lineText });
        }
        this.pos = end;
        continue;
      }

      if (ch === '\n') this.line++;

      switch (this.mode) {
        case 'line-comment':
          if (ch === '\n') this.mode = 'normal';
          this.pos++;
          continue;
        case 'block-comment':
          if (ch === '*' && s[this.pos + 1] === '/') {
            if (--this.blockDepth === 0) this.mode = 'normal';
            this.pos += 2;
          } else if (ch === '/' && s[this.pos + 1] === '*') {
            this.blockDepth++;
            this.pos += 2;
          } else this.pos++;
          continue;
        case 'single':
          if (ch === "'") this.mode = 'normal'; // '' is two adjacent strings: same effect
          this.pos++;
          continue;
        case 'escape-single':
          if (ch === '\\') this.pos += 2;
          else {
            if (ch === "'") this.mode = 'normal';
            this.pos++;
          }
          continue;
        case 'double':
          if (ch === '"') this.mode = 'normal';
          this.pos++;
          continue;
        case 'dollar': {
          const close = `$${this.dollarTag}$`;
          if (s.startsWith(close, this.pos)) {
            this.mode = 'normal';
            this.pos += close.length;
          } else if (ch === '$' && s.length - this.pos < close.length && !final) {
            return this.compact(events); // closing tag may be split across chunks
          } else this.pos++;
          continue;
        }
      }

      // normal mode
      if (ch === '\\' && this.blank) {
        // psql meta-command at statement start: skip the line.
        const nl = s.indexOf('\n', this.pos);
        if (nl === -1 && !final) break;
        this.pos = nl === -1 ? s.length : nl + 1;
        this.line++;
        this.stmtStart = this.pos;
        this.stmtLine = this.line;
        continue;
      }
      if (this.blank && /\s/.test(ch)) {
        this.pos++;
        continue;
      }
      if (ch === '-' && s[this.pos + 1] === '-') {
        this.mode = 'line-comment';
        this.pos += 2;
        continue;
      }
      if (ch === '/' && s[this.pos + 1] === '*') {
        this.mode = 'block-comment';
        this.blockDepth = 1;
        this.pos += 2;
        continue;
      }
      if (ch === "'") {
        this.blank = false;
        const prev = s[this.pos - 1];
        const prev2 = s[this.pos - 2];
        this.mode = (prev === 'E' || prev === 'e') && !(prev2 && /[\w$]/.test(prev2)) ? 'escape-single' : 'single';
        this.pos++;
        continue;
      }
      this.blank = false;
      if (ch === '"') {
        this.mode = 'double';
        this.pos++;
        continue;
      }
      if (ch === '$') {
        const rest = s.slice(this.pos, this.pos + 128);
        const m = /^\$([A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/.exec(rest);
        const prev = s[this.pos - 1];
        if (m && !(prev && /[\w$]/.test(prev))) {
          this.mode = 'dollar';
          this.dollarTag = m[1] ?? '';
          this.pos += m[0].length;
          continue;
        }
        if (!m && !rest.includes('$', 1) && rest.length < 128 && !final) return this.compact(events);
        this.pos++;
        continue;
      }
      if (ch === ';') {
        const sql = s.slice(this.stmtStart, this.pos + 1);
        this.pos++;
        if (sql.replace(/;$/, '').trim()) {
          if (COPY_FROM_STDIN.test(stripLeadingComments(sql))) {
            events.push({ type: 'copy', sql, line: this.stmtLine });
            this.mode = 'copy-eol';
          } else events.push({ type: 'stmt', sql, line: this.stmtLine });
        }
        this.stmtStart = this.pos;
        this.stmtLine = this.line;
        this.blank = true;
        continue;
      }
      this.pos++;
    }

    if (final) {
      const tail = this.buf.slice(this.stmtStart).trim();
      if (this.mode === 'copy' || this.mode === 'copy-eol')
        throw new UserError('The dump ended inside a COPY block (missing "\\.").');
      if (tail && this.mode === 'normal') events.push({ type: 'stmt', sql: tail, line: this.stmtLine });
    }
    return this.compact(events);
  }

  /** Drop consumed text so the buffer only holds the statement in progress. */
  private compact(events: Event[]): Event[] {
    const cut = this.mode === 'copy' || this.mode === 'copy-eol' ? this.pos : this.stmtStart;
    if (cut > 0) {
      this.buf = this.buf.slice(cut);
      this.pos -= cut;
      this.stmtStart -= cut;
    }
    return events;
  }
}

/** Run pg_restore to turn a custom-format dump on stdin into SQL on stdout. */
function pgRestoreToSql(input: Readable): Readable {
  const child = spawn('pg_restore', ['--no-owner', '--no-privileges', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const out = child.stdout;
  child.on('error', (e: NodeJS.ErrnoException) =>
    out.destroy(
      e.code === 'ENOENT'
        ? new UserError(
            'This is a pg_dump custom-format file. Restoring it needs pg_restore installed where pgdeck runs (or dump with --format=plain).',
          )
        : e,
    ),
  );
  child.on('close', (code) => {
    if (code)
      out.destroy(
        new UserError(`pg_restore failed: ${stderr.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`}`),
      );
  });
  input.on('error', (e) => child.stdin.destroy(e));
  input.pipe(child.stdin).on('error', () => {});
  return out;
}

/** Attach "where in the dump" context to a Postgres error. */
function annotate(err: unknown, line: number, sql: string): unknown {
  if (err instanceof pg.DatabaseError) {
    const snippet = sql.trim().replace(/\s+/g, ' ').slice(0, 160);
    err.where = [err.where, `line ${line} of the dump: ${snippet}${snippet.length >= 160 ? '…' : ''}`]
      .filter(Boolean)
      .join('\n');
  }
  return err;
}

/** Execute a psql-style SQL script (e.g. pg_dump --format=plain output) from a stream. */
/** Split SQL into statements, honouring quotes, dollar-quotes and comments. */
export function splitStatements(sql: string): string[] {
  // The trailing newline closes a final line comment so its statement is kept.
  return new ScriptScanner()
    .push(`${sql}\n`, true)
    .filter((e): e is Extract<typeof e, { type: 'stmt' }> => e.type === 'stmt')
    .map((e) => e.sql);
}

export async function restoreScript(ctx: DbContext, body: Readable, opts: RestoreOptions): Promise<RestoreResponse> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);

  // Count bytes in a pass-through stage: a 'data' listener on `body` would
  // start it flowing before the parser is attached and lose data.
  let bytes = 0;
  const counted = body.pipe(
    new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        cb(null, chunk);
      },
    }),
  );
  body.on('error', (e) => counted.destroy(e));
  let source: Readable = opts.gzip ? counted.pipe(createGunzip()) : counted;
  if (opts.gzip) counted.on('error', (e) => source.destroy(e));
  if (opts.custom) source = pgRestoreToSql(source);
  source.setEncoding('utf8');

  const started = performance.now();
  const scanner = new ScriptScanner();
  const client = await ctx.pool.connect();
  const result: RestoreResponse = { statements: 0, skipped: 0, copies: 0, rows: 0, ms: 0, bytes: 0 };
  let copy: ReturnType<typeof copyFrom> | null = null;
  let copyLine = 0;
  let copySql = '';

  const run = async (events: Event[]) => {
    for (const ev of events) {
      if (ev.type === 'stmt') {
        const head = stripLeadingComments(ev.sql);
        if (opts.skipOwnership && OWNERSHIP.test(head)) {
          result.skipped++;
          continue;
        }
        try {
          if (SETTING.test(head) && opts.singleTransaction) {
            // Settings from newer pg_dump versions may not exist on this server; don't let them abort the restore.
            await client.query('savepoint pgdeck_set');
            try {
              await client.query(ev.sql);
            } catch (e) {
              await client.query('rollback to savepoint pgdeck_set');
              if ((e as pg.DatabaseError).code !== '42704' && (e as pg.DatabaseError).code !== '22023') throw e;
              result.skipped++;
              continue;
            }
            await client.query('release savepoint pgdeck_set');
          } else if (SETTING.test(head)) {
            try {
              await client.query(ev.sql);
            } catch (e) {
              if ((e as pg.DatabaseError).code !== '42704' && (e as pg.DatabaseError).code !== '22023') throw e;
              result.skipped++;
              continue;
            }
          } else {
            await client.query(ev.sql);
          }
          result.statements++;
        } catch (e) {
          throw annotate(e, ev.line, ev.sql);
        }
      } else if (ev.type === 'copy') {
        copy = client.query(copyFrom(ev.sql));
        copyLine = ev.line;
        copySql = ev.sql;
      } else if (ev.type === 'data') {
        const c = copy!;
        if (!c.write(ev.text))
          await new Promise<void>((resolve, reject) => {
            c.once('drain', resolve);
            c.once('error', reject);
          });
      } else {
        const c = copy!;
        try {
          await new Promise<void>((resolve, reject) => {
            c.once('finish', resolve);
            c.once('error', reject);
            c.end();
          });
        } catch (e) {
          throw annotate(e, copyLine, copySql);
        }
        result.copies++;
        result.rows += c.rowCount;
        copy = null;
      }
    }
  };

  try {
    if (opts.singleTransaction) await client.query('begin');
    for await (const chunk of source) await run(scanner.push(chunk as string, false));
    await run(scanner.push('', true));
    if (opts.singleTransaction) await client.query('commit');
    return { ...result, ms: performance.now() - started, bytes };
  } catch (err) {
    if (copy) (copy as ReturnType<typeof copyFrom>).destroy();
    if (opts.singleTransaction) await client.query('rollback').catch(() => {});
    if ((err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE')
      throw new UserError('Upload was cancelled.');
    if ((err as NodeJS.ErrnoException).code === 'Z_DATA_ERROR') throw new UserError('The file is not valid gzip.');
    throw err;
  } finally {
    // A failed COPY leaves the connection unusable; don't return it to the pool.
    client.release(copy !== null);
    source.destroy();
  }
}
