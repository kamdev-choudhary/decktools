export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
  modified: Date | null;
  dir: boolean;
}

export const MAX_CENTRAL_DIR = 32 * 1024 * 1024;

/** Reads bytes [start, end] (inclusive) of the archive. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/**
 * Lists a ZIP archive by reading only its end record and central directory,
 * so multi-gigabyte archives cost two or three small range requests.
 */
export async function readZipListing(size: number, read: ReadRange): Promise<ZipEntry[]> {
  // End of central directory: 22 bytes + up to 64 KB comment, at the end of the file.
  const tailLen = Math.min(size, 22 + 0xffff);
  const tail = await read(size - tailLen, size - 1);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file, or the archive is damaged.');

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  // ZIP64: the real values live in the ZIP64 end-of-central-directory record.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== 0x07064b50) throw new Error('Unsupported ZIP64 archive.');
    const z64Offset = Number(tv.getBigUint64(loc + 8, true));
    const z = await read(z64Offset, z64Offset + 55);
    const zv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    if (zv.getUint32(0, true) !== 0x06064b50) throw new Error('Unsupported ZIP64 archive.');
    count = Number(zv.getBigUint64(32, true));
    cdSize = Number(zv.getBigUint64(40, true));
    cdOffset = Number(zv.getBigUint64(48, true));
  }
  if (cdSize > MAX_CENTRAL_DIR) throw new Error(`This archive lists too many files to preview (${count.toLocaleString()}).`);
  if (cdSize === 0) return [];

  const cd = await read(cdOffset, cdOffset + cdSize - 1);
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const utf8 = new TextDecoder('utf-8', { fatal: false });
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50) {
    const time = v.getUint16(p + 12, true);
    const date = v.getUint16(p + 14, true);
    let compressed = v.getUint32(p + 20, true);
    let uncompressed = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));

    // ZIP64 extra field (0x0001) holds sizes that overflow 32 bits, in this order.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let f = e + 4;
        if (uncompressed === 0xffffffff && f + 8 <= e + 4 + len) {
          uncompressed = Number(v.getBigUint64(f, true));
          f += 8;
        }
        if (compressed === 0xffffffff && f + 8 <= e + 4 + len) compressed = Number(v.getBigUint64(f, true));
      }
      e += 4 + len;
    }

    const modified =
      date === 0
        ? null
        : new Date((date >> 9) + 1980, ((date >> 5) & 0xf) - 1, date & 0x1f, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2);
    entries.push({ name, size: uncompressed, compressed, modified, dir: name.endsWith('/') });
    p = extraEnd + commentLen;
  }
  return entries;
}
