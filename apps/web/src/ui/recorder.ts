import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Microphone recording with MediaRecorder.
 * - Permission is requested only when the user presses Record.
 * - The microphone is released as soon as recording stops.
 * - Formats differ by browser (WebM/Opus in Chrome/Firefox/Edge, MP4/AAC in Safari).
 */
export type RecorderState = 'idle' | 'requesting' | 'recording' | 'denied' | 'no-microphone' | 'unsupported' | 'error';

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === 'function';
}

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return PREFERRED.find((t) => MediaRecorder.isTypeSupported(t));
}

export interface Recording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export function useRecorder(maxSeconds: number, onDone: (r: Recording) => void) {
  const [state, setState] = useState<RecorderState>(() => (recordingSupported() ? 'idle' : 'unsupported'));
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const started = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const release = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => {
    if (rec.current?.state === 'recording') rec.current.stop();
    release();
  }, []);

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!recordingSupported()) return setState('unsupported');
    setError(null);
    setState('requesting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      release();
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('no-microphone');
      else {
        setState('error');
        setError((e as Error).message);
      }
      return;
    }
    const mimeType = pickMimeType();
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    rec.current = r;
    r.ondataavailable = (ev) => ev.data.size > 0 && chunks.push(ev.data);
    r.onstop = () => {
      const durationMs = Date.now() - started.current;
      release();
      setState('idle');
      setElapsed(0);
      const mime = (r.mimeType || mimeType || 'audio/webm').split(';')[0]!;
      if (chunks.length) done.current({ blob: new Blob(chunks, { type: mime }), mime, durationMs });
    };
    r.onerror = () => {
      release();
      setState('error');
      setError('Recording stopped unexpectedly.');
    };
    started.current = Date.now();
    r.start(250);
    setState('recording');
    tick.current = setInterval(() => {
      const s = (Date.now() - started.current) / 1000;
      setElapsed(s);
      if (s >= maxSeconds) r.stop();
    }, 200);
  }, [maxSeconds]);

  return { state, elapsed, error, start, stop };
}

export const RECORDER_MESSAGES: Record<RecorderState, string> = {
  idle: '',
  requesting: 'Waiting for microphone permission…',
  recording: 'Recording…',
  denied: 'Microphone access is blocked. Allow the microphone for this site in your browser settings (usually the icon in the address bar), then try again. You can also upload a recording instead.',
  'no-microphone': 'No microphone was found. Connect one, or upload a recording instead.',
  unsupported: 'This browser cannot record audio here. You can upload a recording made with another app instead.',
  error: 'Something went wrong while recording.',
};
