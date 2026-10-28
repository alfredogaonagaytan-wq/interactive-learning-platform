import { useEffect, useId, useRef, useState } from 'react';

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

/**
 * Accessible audio player with teacher-set limits.
 * - A "play" is counted when playback starts from the beginning (or the start of
 *   the linked segment). Pause/resume does not count again.
 * - With a play limit, seeking is disabled so the limit means something.
 * - Speed choices come from the activity settings.
 */
export function AudioPlayer({ src, label, maxPlays, playsUsed, onPlay, speeds = [1], segment = null, disabled = false, compact = false }: {
  src: string | null;
  label: string;
  maxPlays: number | null;
  playsUsed: number;
  onPlay: () => void;
  speeds?: number[];
  segment?: { start: number | null; end: number | null } | null;
  disabled?: boolean;
  compact?: boolean;
}) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [rate, setRate] = useState(speeds.includes(1) ? 1 : speeds[0]!);
  const [error, setError] = useState<string | null>(null);
  const speedId = useId();
  const start = segment?.start ?? 0;
  const end = segment?.end ?? null;
  const left = maxPlays === null ? null : Math.max(0, maxPlays - playsUsed);
  const exhausted = left === 0 && !resumable;

  useEffect(() => {
    if (el.current) el.current.playbackRate = rate;
  }, [rate]);

  const play = async (fromStart: boolean) => {
    const a = el.current;
    if (!a || disabled) return;
    if (fromStart) {
      if (left === 0) return;
      onPlay();
      a.currentTime = start;
    }
    a.playbackRate = rate;
    try {
      await a.play();
      setError(null);
    } catch (e) {
      setError((e as Error).name === 'NotAllowedError' ? 'Press play again to start the audio.' : 'This audio could not be played on this device.');
    }
  };

  if (!src) return <p className="notice error">Audio is not available on this device. Ask your teacher for the activity file again.</p>;

  return (
    <div className={`audio-player ${compact ? 'compact' : ''}`} role="group" aria-label={label}>
      <audio
        ref={el}
        src={src}
        preload="metadata"
        onPlay={() => { setPlaying(true); setResumable(true); }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setResumable(false); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setError('This audio could not be loaded.')}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setTime(t);
          if (end !== null && t >= end) {
            e.currentTarget.pause();
            setResumable(false);
          }
        }}
      />
      <div className="audio-row">
        {playing ? (
          <button type="button" className="primary" onClick={() => el.current?.pause()}>Pause</button>
        ) : resumable ? (
          <>
            <button type="button" className="primary" disabled={disabled} onClick={() => play(false)}>Resume</button>
            <button type="button" className="secondary" disabled={disabled || left === 0} onClick={() => play(true)}>Play from start</button>
          </>
        ) : (
          <button type="button" className="primary" disabled={disabled || exhausted} onClick={() => play(true)}>
            {segment && (segment.start !== null || segment.end !== null) ? 'Play this part' : 'Play'}
          </button>
        )}
        <span className="audio-time" aria-hidden="true">{fmt(time - start)} / {fmt((end ?? duration) - start)}</span>
        {maxPlays === null ? (
          <input type="range" className="audio-seek" aria-label={`${label}: position`} min={start} max={Number.isFinite(end ?? duration) ? (end ?? duration) : 0} step={0.1} value={time} disabled={disabled} onChange={(e) => { if (el.current) el.current.currentTime = Number(e.target.value); }} />
        ) : (
          <progress className="audio-seek" aria-hidden="true" max={Number.isFinite((end ?? duration) - start) ? (end ?? duration) - start : 1} value={Math.max(0, time - start)} />
        )}
        {speeds.length > 1 && (
          <span className="audio-speed">
            <label htmlFor={speedId}>Speed</label>
            <select id={speedId} value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {speeds.map((s) => <option key={s} value={s}>{s === 1 ? 'Normal' : `${s}×`}</option>)}
            </select>
          </span>
        )}
      </div>
      {left !== null && <p className="meta audio-plays" aria-live="polite">{left === 0 ? (resumable ? 'Last play.' : 'No plays left.') : `${left} play${left === 1 ? '' : 's'} left`}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}
