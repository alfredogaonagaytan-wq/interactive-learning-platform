import { useEffect, useState } from 'react';
import { AUDIO_TYPES, checkMedia, IMAGE_TYPES } from '@ilp/core';
import { getAsset, putAsset } from './db';

/** Validate an uploaded image (by file signature) and store it. Returns the asset id. */
export async function addImageFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { id, mime } = await checkMedia(bytes, IMAGE_TYPES);
  await putAsset({ id, mime, bytes, name: file.name.slice(0, 120), addedAt: new Date().toISOString() });
  return id;
}

/** Validate and store an audio file or a teacher's recording. Returns the asset id. */
export async function addAudioBytes(bytes: Uint8Array, name: string): Promise<string> {
  const { id, mime } = await checkMedia(bytes, AUDIO_TYPES);
  await putAsset({ id, mime, bytes, name: name.slice(0, 120), addedAt: new Date().toISOString() });
  return id;
}

const urls = new Map<string, { url: string; refs: number }>();

/** Object URL for a stored asset; released when no component uses it. */
export function useAssetUrl(id: string | null | undefined): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean }>(() => ({ url: id ? (urls.get(id)?.url ?? null) : null, missing: false }));
  useEffect(() => {
    if (!id) {
      setState({ url: null, missing: false });
      return;
    }
    let cancelled = false;
    let acquired = false;
    const cached = urls.get(id);
    if (cached) {
      cached.refs++;
      acquired = true;
      setState({ url: cached.url, missing: false });
    } else {
      void getAsset(id).then((a) => {
        if (cancelled) return;
        if (!a) return setState({ url: null, missing: true });
        const existing = urls.get(id);
        const entry = existing ?? { url: URL.createObjectURL(new Blob([a.bytes as Uint8Array<ArrayBuffer>], { type: a.mime })), refs: 0 };
        entry.refs++;
        urls.set(id, entry);
        acquired = true;
        setState({ url: entry.url, missing: false });
      });
    }
    return () => {
      cancelled = true;
      if (!acquired) return;
      const e = urls.get(id);
      if (e && --e.refs <= 0) {
        URL.revokeObjectURL(e.url);
        urls.delete(id);
      }
    };
  }, [id]);
  return state;
}
