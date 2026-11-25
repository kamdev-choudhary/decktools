import { ZipArchive } from 'archiver';
import { describe, expect, it } from 'vitest';
import { previewKind, languageFor } from '@/lib/file-types';
import { readZipListing } from '@/lib/zip-listing';

async function makeZip(files: Record<string, string>, opts: { forceZip64?: boolean } = {}): Promise<Uint8Array> {
  const zip = new ZipArchive({ zlib: { level: 6 }, ...opts });
  const chunks: Buffer[] = [];
  zip.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    zip.on('end', () => resolve());
    zip.on('error', reject);
  });
  for (const [name, body] of Object.entries(files)) {
    if (name.endsWith('/')) zip.append('', { name });
    else zip.append(body, { name, date: new Date(2024, 4, 17, 10, 30, 0) });
  }
  await zip.finalize();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

/** A ReadRange over a buffer that also records the requested ranges. */
function reader(buf: Uint8Array) {
  const calls: [number, number][] = [];
  const read = async (a: number, b: number) => {
    calls.push([a, b]);
    if (a < 0 || b >= buf.length || a > b) throw new Error(`bad range ${a}-${b}`);
    return buf.slice(a, b + 1);
  };
  return { read, calls };
}

describe('zip listing', () => {
  it('lists names, sizes and dates from the central directory', async () => {
    const big = 'x'.repeat(50_000);
    const buf = await makeZip({ 'readme.txt': 'hello', 'src/': '', 'src/big.txt': big, 'ünï cödé.md': '# hi' });
    const { read, calls } = reader(buf);
    const entries = await readZipListing(buf.length, read);

    expect(entries.map((e) => e.name)).toEqual(['readme.txt', 'src/', 'src/big.txt', 'ünï cödé.md']);
    const bigEntry = entries.find((e) => e.name === 'src/big.txt')!;
    expect(bigEntry.size).toBe(50_000);
    expect(bigEntry.compressed).toBeLessThan(50_000);
    expect(bigEntry.modified?.getFullYear()).toBe(2024);
    expect(bigEntry.modified?.getMonth()).toBe(4);
    expect(entries.find((e) => e.name === 'src/')?.dir).toBe(true);
    // Only the tail and the central directory are read, never the file data.
    expect(calls).toHaveLength(2);
  });

  it('reads ZIP64 archives', async () => {
    const buf = await makeZip({ 'a.txt': 'aaa', 'b/c.txt': 'cccc' }, { forceZip64: true });
    const entries = await readZipListing(buf.length, reader(buf).read);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['a.txt', 3],
      ['b/c.txt', 4],
    ]);
  });

  it('handles an empty archive', async () => {
    const buf = await makeZip({});
    expect(await readZipListing(buf.length, reader(buf).read)).toEqual([]);
  });

  it('rejects files that are not ZIPs', async () => {
    const buf = new TextEncoder().encode('definitely not a zip file '.repeat(10));
    await expect(readZipListing(buf.length, reader(buf).read)).rejects.toThrow(/Not a ZIP/);
  });
});

describe('preview kinds', () => {
  it.each([
    ['logo.svg', 'svg'],
    ['index.html', 'html'],
    ['Inter.woff2', 'font'],
    ['report.xlsx', 'spreadsheet'],
    ['letter.docx', 'docx'],
    ['events.parquet', 'parquet'],
    ['app.jar', 'zip'],
    ['backup.zip', 'zip'],
    ['photo.jfif', 'image'],
    ['clip.mkv', 'video'],
    ['data.ndjson', 'json'],
    ['pipe.psv', 'csv'],
    ['Makefile', 'code'],
    ['Dockerfile.dev', 'code'],
    ['main.dart', 'code'],
    ['cert.pem', 'text'],
    ['archive.tar.gz', 'none'],
  ])('%s → %s', (name, kind) => {
    expect(previewKind(name)).toBe(kind);
  });

  it('detects by content type when the extension is unknown', () => {
    expect(previewKind('blob', 'image/svg+xml')).toBe('svg');
    expect(previewKind('blob', 'text/html; charset=utf-8')).toBe('html');
    expect(previewKind('blob', 'font/woff2')).toBe('font');
  });

  it('picks languages for named files', () => {
    expect(languageFor('Makefile')).toBe('makefile');
    expect(languageFor('Gemfile')).toBe('ruby');
    expect(languageFor('Dockerfile.prod')).toBe('dockerfile');
  });
});
