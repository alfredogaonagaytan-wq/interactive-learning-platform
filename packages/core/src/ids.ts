/**
 * Stable, URL-safe identifiers. IDs never depend on titles or file names, so
 * renaming an activity never breaks links, reports or Drive files.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

export type IdPrefix = 'act' | 'itm' | 'chc' | 'blk' | 'att' | 'rpt' | 'pkg' | 'asg' | 'cls';

export function randomId(prefix: IdPrefix, length = 16): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return `${prefix}_${out}`;
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
