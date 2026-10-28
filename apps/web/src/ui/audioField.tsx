import { useRef, useState } from 'react';
import type { AudioRef } from '@ilp/core';
import { addAudioBytes, useAssetUrl } from '../storage/assets';
import { RECORDER_MESSAGES, useRecorder } from './recorder';
import { AudioPlayer } from './audioPlayer';
import { blobBytes } from '../app/util';

/** Teacher audio: upload a file or record narration in the browser; optional transcript. */
export function AudioField({ label, value, onChange, transcript = true, maxSeconds = 600 }: { label: string; value: AudioRef | null; onChange: (v: AudioRef | null) => void; transcript?: boolean; maxSeconds?: number }) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { url } = useAssetUrl(value?.assetId);
  const store = async (bytes: Uint8Array, name: string) => {
    try {
      setError(null);
      const assetId = await addAudioBytes(bytes, name);
      onChange({ assetId, transcript: value?.transcript ?? '' });
    } catch (e) {
      setError((e as Error).message.replace('Use PNG, JPEG, GIF or WebP images (SVG is not allowed).', 'Use MP3, M4A, OGG, WAV or WebM audio.'));
    }
  };
  const rec = useRecorder(maxSeconds, async (r) => store(await blobBytes(r.blob), `recording.${r.mime.split('/')[1]}`));
  return (
    <fieldset className="audio-field">
      <legend>{label}</legend>
      {value && <AudioPlayer src={url} label={`${label} preview`} maxPlays={null} playsUsed={0} onPlay={() => {}} compact />}
      <div className="row wrap">
        <button type="button" className="secondary" onClick={() => file.current?.click()}>{value ? 'Replace with a file…' : 'Upload audio…'}</button>
        {rec.state === 'recording' ? (
          <button type="button" className="danger-btn" onClick={rec.stop}>Stop recording ({Math.floor(rec.elapsed)} s)</button>
        ) : (
          <button type="button" className="secondary" disabled={rec.state === 'requesting' || rec.state === 'unsupported'} onClick={rec.start}>{value ? 'Record again' : 'Record narration'}</button>
        )}
        {value && <button type="button" className="ghost danger" onClick={() => onChange(null)}>Remove</button>}
        <input ref={file} type="file" accept="audio/*" hidden aria-label={`${label}: upload`} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await store(await blobBytes(f), f.name); }} />
      </div>
      {rec.state !== 'idle' && rec.state !== 'recording' && <p className="field-hint" role="status">{RECORDER_MESSAGES[rec.state]}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {value && transcript && (
        <div className="field">
          <label>
            <span className="label-text">Transcript</span>
            <textarea rows={3} value={value.transcript} onChange={(e) => onChange({ ...value, transcript: e.target.value })} />
          </label>
          <p className="field-hint">Needed for deaf and hard-of-hearing students; you choose below when students may see it.</p>
        </div>
      )}
      <p className="field-hint">MP3, M4A, OGG, WAV or WebM, up to 20 MB. Audio is stored on this device and included in exported packages, so it works offline. Google Drive audio arrives with Google sign-in (Phase 5).</p>
    </fieldset>
  );
}
