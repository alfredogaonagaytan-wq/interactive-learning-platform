import { useId } from 'react';
import { dictationResult, type DictationItem, type DictationResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, SkillsField, TextArea, TextField } from '../../ui/fields';
import { LinesField } from '../../ui/lists';
import { AudioField } from '../../ui/audioField';
import { AudioPlayer } from '../../ui/audioPlayer';
import { useAssetUrl } from '../../storage/assets';
import type { ItemPlugin } from '../types';

export const dictationPlugin: ItemPlugin<DictationItem, DictationResponse> = {
  type: 'dictation',
  label: 'Dictation',
  description: 'Students listen and type. Mistakes are counted word by word.',
  Editor({ item, onChange }) {
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <AudioField label="Audio" value={item.audio} transcript={false} onChange={(audio) => onChange({ ...item, audio })} />
        <TextArea label="Exact text that is spoken" value={item.text} onChange={(text) => onChange({ ...item, text })} />
        <LinesField label="Other acceptable versions of the whole text (optional), one per line" value={item.alternatives} onChange={(alternatives) => onChange({ ...item, alternatives })} />
        <NumberField label="Plays allowed" value={item.maxPlays} min={1} max={20} nullable onChange={(maxPlays) => onChange({ ...item, maxPlays })} />
        <Checkbox label="Offer a slower speed (0.75×)" checked={item.slowSpeed} onChange={(slowSpeed) => onChange({ ...item, slowSpeed })} />
        <Checkbox label="Count one-letter slips in longer words as half a mistake" checked={item.typoHalf} onChange={(typoHalf) => onChange({ ...item, typoHalf })} />
        <Checkbox label="Capitalization must match" checked={item.match.caseSensitive} onChange={(caseSensitive) => onChange({ ...item, match: { ...item.match, caseSensitive } })} />
        <Checkbox label="Punctuation must match" checked={item.match.punctuationSensitive} onChange={(punctuationSensitive) => onChange({ ...item, match: { ...item.match, punctuationSensitive } })} />
        <p className="field-hint">Score = points × (1 − mistakes ÷ number of words). Missing, extra and wrong words each count as one mistake.</p>
        <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} hint={false} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, label, ctx }) {
    const id = useId();
    const { url } = useAssetUrl(item.audio?.assetId);
    const diff = result ? dictationResult(item, response.text, ctx?.activity.language ?? 'en') : null;
    // Expected words are only shown when the teacher's settings allow answers to be revealed.
    const reveal = showKey || !!ctx?.reveal;
    return (
      <div className="dictation">
        <p className="prompt">{item.prompt}</p>
        <AudioPlayer src={item.audio ? url : null} label={`${label} audio`} maxPlays={ctx?.mode === 'teacher-preview' ? null : item.maxPlays} playsUsed={ctx?.plays(item.id) ?? 0} onPlay={() => ctx?.countPlay(item.id)} speeds={item.slowSpeed ? [0.75, 1] : [1]} />
        <label htmlFor={id} className="label-text">What you heard</label>
        <textarea id={id} rows={3} disabled={disabled} value={response.text} spellCheck={false} autoCapitalize="off" autoComplete="off" onChange={(e) => onChange({ text: e.target.value })} />
        {diff && (
          <p className="word-diff" aria-label="Word-by-word comparison">
            {diff.ops.map((o, k) => (
              <span key={k} className={`wd wd-${o.op}`}>
                {o.op === 'missing' ? (reveal ? `(${o.expected})` : '(…)') : o.given}
                {reveal && (o.op === 'wrong' || o.op === 'typo') && <span className="wd-expected"> → {o.expected}</span>}
                <span className="sr-only">{o.op === 'match' ? '' : o.op === 'missing' ? ' missing word' : o.op === 'extra' ? ' extra word' : o.op === 'typo' ? ' spelling slip' : ' wrong word'}</span>
              </span>
            ))}
          </p>
        )}
        {showKey && <p className="badge key">{item.text}</p>}
      </div>
    );
  },
};
