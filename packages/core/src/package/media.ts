import { sha256Hex } from '../hash';

/**
 * Media accepted into the asset store and packages. Types are identified by
 * their file signature (magic bytes), not by file name or browser-reported
 * MIME type. SVG and HTML are deliberately excluded (they can carry script).
 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'] as const;
/** Original reading files kept for comparison. Never rendered as HTML by the app. */
export const DOCUMENT_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'] as const;
export type MediaType = (typeof IMAGE_TYPES)[number] | (typeof AUDIO_TYPES)[number] | (typeof DOCUMENT_TYPES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const EXTENSIONS: Record<MediaType, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm',
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt',
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

/** Media first, then documents. A zip (PK) is only treated as .docx when documents are allowed. Text must be valid UTF-8 without NUL bytes. */
export function sniffAnyType(b: Uint8Array): MediaType | null {
  const media = sniffMediaType(b);
  if (media) return media;
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (b.length > 0 && !b.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(b);
      return 'text/plain';
    } catch {
      return null;
    }
  }
  return null;
}

export class MediaError extends Error {}

export interface MediaCheck {
  mime: MediaType;
  id: string;
}

/** Validate bytes and derive the content-addressed asset id ("ast_" + 40 hex chars of SHA-256). */
export async function checkMedia(bytes: Uint8Array, allowed: readonly MediaType[] = [...IMAGE_TYPES, ...AUDIO_TYPES]): Promise<MediaCheck> {
  const mime = sniffAnyType(bytes);
  if (!mime || !allowed.includes(mime)) {
    const kinds = allowed.some((t) => t.startsWith('image/')) && !allowed.some((t) => t.startsWith('audio/')) ? 'Use PNG, JPEG, GIF or WebP images (SVG is not allowed).' : allowed.some((t) => t.startsWith('audio/')) && !allowed.some((t) => t.startsWith('image/')) ? 'Use MP3, M4A, OGG, WAV or WebM audio.' : 'This file type is not supported.';
    throw new MediaError(`Unsupported file. ${kinds}`);
  }
  const limit = mime.startsWith('image/') ? MAX_IMAGE_BYTES : mime.startsWith('audio/') ? MAX_AUDIO_BYTES : MAX_DOCUMENT_BYTES;
  if (bytes.byteLength > limit) throw new MediaError(`File is too large (limit ${Math.round(limit / 1024 / 1024)} MB).`);
  return { mime, id: await assetIdFor(bytes) };
}

export async function assetIdFor(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `ast_${hex.slice(0, 40)}`;
}

export { sha256Hex };
