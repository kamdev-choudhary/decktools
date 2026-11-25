import type { RText } from '../shared/types.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Escape bytes the way redis-cli does: printable ASCII as-is, the rest as \xHH. */
export function escapeBytes(buf: Buffer): string {
  let out = '';
  for (const b of buf) {
    if (b === 0x5c) out += '\\\\';
    else if (b === 0x22) out += '\\"';
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x0d) out += '\\r';
    else if (b === 0x09) out += '\\t';
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** UTF-8 text when the bytes are valid UTF-8, otherwise an escaped, read-only rendering. */
export function toRText(buf: Buffer): RText {
  try {
    return { text: utf8.decode(buf) };
  } catch {
    return { text: escapeBytes(buf), binary: true };
  }
}

/** Key ids are the raw key bytes in base64, so binary keys survive the round trip. */
export const keyId = (key: Buffer): string => key.toString('base64');
export const keyFromId = (id: string): Buffer => Buffer.from(id, 'base64');
