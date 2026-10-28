import { sha256Hex } from '../hash';

/**
 * Media accepted into the asset store and packages. Types are identified by
 * their file signature (magic bytes), not by file name or browser-reported
 * MIME type. SVG and HTML are deliberately excluded (they can carry script).
 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'] as const;
export type MediaType = (typeof IMAGE_TYPES)[number] | (typeof AUDIO_TYPES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export const EXTENSIONS: Record<MediaType, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm',
};

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));

export function sniffMediaType(b: Uint8Array): MediaType | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (ascii(b, 4, 4) === 'ftyp') return 'audio/mp4';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

export class MediaError extends Error {}

export interface MediaCheck {
  mime: MediaType;
  id: string;
}

/** Validate bytes and derive the content-addressed asset id ("ast_" + 40 hex chars of SHA-256). */
export async function checkMedia(bytes: Uint8Array, allowed: readonly MediaType[] = [...IMAGE_TYPES, ...AUDIO_TYPES]): Promise<MediaCheck> {
  const mime = sniffMediaType(bytes);
  if (!mime || !allowed.includes(mime)) throw new MediaError('Unsupported file. Use PNG, JPEG, GIF or WebP images (SVG is not allowed).');
  const limit = mime.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (bytes.byteLength > limit) throw new MediaError(`File is too large (limit ${Math.round(limit / 1024 / 1024)} MB).`);
  return { mime, id: await assetIdFor(bytes) };
}

export async function assetIdFor(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `ast_${hex.slice(0, 40)}`;
}

export { sha256Hex };
