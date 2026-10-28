import { Fragment, useMemo } from 'react';
import { dragWordTokens, seededShuffle, type BlankSegment, type DragWordsItem, type DragWordsResponse } from '@ilp/core';
import { FeedbackFields, NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { LinesField } from '../../ui/lists';
import { usePlacement } from '../../ui/placement';
import { BlankMarkupField } from '../fillBlanks';
import type { ItemPlugin } from '../types';

const invert = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

export const dragWordsPlugin: ItemPlugin<DragWordsItem, DragWordsResponse> = {
  type: 'drag-words',
  label: 'Drag the words',
  description: 'Students drag (or tap) words into gaps. Add extra words as distractors.',
  Editor({ item, onChange }) {
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <BlankMarkupField
          label="Text with gaps"
          segments={item.segments}
          onChange={(segments) => onChange({ ...item, segments })}
          placeholder="Plants use [sunlight] to make [glucose]."
          hint={<>Put each word to drag in <kbd>[square brackets]</kbd>. Optional: other words also accepted in that gap after <kbd>|</kbd>.</>}
        />
        <LinesField label="Extra words (distractors), one per line" value={item.distractors} onChange={(distractors) => onChange({ ...item, distractors })} />
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[{ value: 'per-blank', label: 'Share points between gaps' }, { value: 'all-or-nothing', label: 'All gaps must be correct' }]} />
        </div>
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const tokens = useMemo(() => seededShuffle(dragWordTokens(item), seed + item.id).map((t) => ({ id: t.id, label: t.text })), [item, seed]);
    const blanks = item.segments.filter((s): s is BlankSegment => s.kind === 'blank');
    const gapIndex = new Map(blanks.map((b, i) => [b.id, i + 1]));
    const parts = new Map(result?.parts.map((p) => [p.partId, p]));
    const p = usePlacement({
      tokens,
      placements: invert(response.placements),
      onChange: (next) => onChange({ placements: invert(next) }),
      capacity: () => 1,
      targetLabel: (id) => `Gap ${gapIndex.get(id)} of ${blanks.length}`,
      disabled,
    });
    return (
      <div className="drag-words" role="group" aria-label={`${label}: ${item.prompt || 'Drag the words'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="instruction">Drag a word into a gap, or tap a word and then tap a gap.</p>
        {p.bank({ label: 'Words to place' })}
        <p className="cloze preserve-lines">
          {item.segments.map((s, i) => {
            if (s.kind === 'text') return <Fragment key={i}>{s.text}</Fragment>;
            const part = parts.get(s.id);
            return (
              <span key={s.id} className="blank-wrap">
                {p.slot(s.id, { status: part ? (part.correct ? 'correct' : 'wrong') : undefined })}
                {showKey && <span className="badge key">{s.answers.join(' / ')}</span>}
              </span>
            );
          })}
        </p>
        {p.overlay}
      </div>
    );
  },
};
