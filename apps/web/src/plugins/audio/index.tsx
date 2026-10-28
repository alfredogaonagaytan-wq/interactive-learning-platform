import { useState } from 'react';
import type { AudioItem } from '@ilp/core';
import { Checkbox, NumberField, Select, TextArea, TextField } from '../../ui/fields';
import { AudioField } from '../../ui/audioField';
import { AudioPlayer } from '../../ui/audioPlayer';
import { useAssetUrl } from '../../storage/assets';
import type { ItemPlugin } from '../types';

const SPEEDS = [0.5, 0.75, 1, 1.25];

export const audioPlugin: ItemPlugin<AudioItem, Record<string, never>> = {
  type: 'audio',
  label: 'Audio clip',
  description: 'A listening passage. Link questions to it (or to parts of it).',
  Editor({ item, onChange }) {
    return (
      <>
        <TextField label="Title (optional)" value={item.title} onChange={(title) => onChange({ ...item, title })} />
        <TextArea label="Instructions" rows={2} value={item.instructions} onChange={(instructions) => onChange({ ...item, instructions })} placeholder="Listen to the conversation. You can play it twice." />
        <AudioField label="Audio" value={item.audio} onChange={(audio) => onChange({ ...item, audio })} />
        <NumberField label="Plays allowed" value={item.maxPlays} min={1} max={20} nullable onChange={(maxPlays) => onChange({ ...item, maxPlays })} hint="Plays of linked question segments count toward this limit. With a limit, students cannot skip around in the audio." />
        <fieldset className="subfieldset">
          <legend>Speeds students can choose</legend>
          {SPEEDS.map((sp) => (
            <Checkbox key={sp} label={sp === 1 ? 'Normal' : `${sp}×`} checked={item.speeds.includes(sp)} onChange={(on) => {
              const next = on ? [...item.speeds, sp].sort() : item.speeds.filter((x) => x !== sp);
              onChange({ ...item, speeds: next.length ? next : [1] });
            }} />
          ))}
        </fieldset>
        <Select label="When students can see the transcript" value={item.transcript} onChange={(transcript) => onChange({ ...item, transcript })} options={[
          { value: 'after-submit', label: 'Shown after submitting' },
          { value: 'on-request', label: 'Students can open it any time (accommodation)' },
          { value: 'always', label: 'Always shown' },
          { value: 'never', label: 'Never shown' },
        ]} />
      </>
    );
  },
  Player({ item, ctx, label }) {
    const { url } = useAssetUrl(item.audio?.assetId);
    const [open, setOpen] = useState(false);
    const t = item.audio?.transcript ?? '';
    const showTranscript = t && (item.transcript === 'always' || (item.transcript === 'after-submit' && ctx?.submitted) || (item.transcript === 'on-request' && open) || ctx?.mode === 'teacher-preview');
    return (
      <div className="audio-block">
        {item.title && <h3>{item.title}</h3>}
        {item.instructions && <p className="preserve-lines">{item.instructions}</p>}
        <AudioPlayer src={item.audio ? url : null} label={item.title || label} maxPlays={ctx?.mode === 'teacher-preview' ? null : item.maxPlays} playsUsed={ctx?.plays(item.id) ?? 0} onPlay={() => ctx?.countPlay(item.id)} speeds={item.speeds} />
        {item.transcript === 'on-request' && t && !ctx?.submitted && (
          <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide transcript' : 'Show transcript'}</button>
        )}
        {showTranscript && (
          <details className="transcript" open>
            <summary>Transcript</summary>
            <p className="preserve-lines">{t}</p>
          </details>
        )}
      </div>
    );
  },
};
