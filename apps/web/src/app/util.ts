export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime = 'application/zip'): void {
  downloadBlob(filename, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(s: string): string {
  return s.replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'activity';
}

export { seededShuffle } from '@ilp/core';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
