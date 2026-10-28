import { Fragment, useMemo } from 'react';
import { seededShuffle, type BlankSegment, type DropdownClozeItem, type DropdownClozeResponse } from '@ilp/core';
import { FeedbackFields, NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { BlankMarkupField } from '../fillBlanks';
import type { ItemPlugin } from '../types';

export const dropdownClozePlugin: ItemPlugin<DropdownClozeItem, DropdownClozeResponse> = {
  type: 'dropdown-cloze',
  label: 'Dropdown cloze',
  description: 'Gaps with a menu of choices. Good for grammar and word forms.',
  Editor({ item, onChange }) {
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <BlankMarkupField
          label="Text with dropdowns"
          segments={item.segments}
          onChange={(segments) => onChange({ ...item, segments })}
          placeholder="She [has | have | having] two brothers."
          hint={<>Write each dropdown as <code>[correct | wrong | wrong]</code>. The <strong>first</strong> option is the correct one; students see the options shuffled.</>}
          renderBlank={(b) => (
            <span className="accepted">
              <mark>{b.answers[0]}</mark> ✓{b.answers.slice(1).map((a, i) => <Fragment key={i}><span className="or"> · </span>{a}</Fragment>)}
            </span>
          )}
        />
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
    const blanks = item.segments.filter((s): s is BlankSegment => s.kind === 'blank');
    const options = useMemo(() => new Map(blanks.map((b) => [b.id, seededShuffle(b.answers, seed + b.id)])), [item, seed]);
    const parts = new Map(result?.parts.map((p) => [p.partId, p]));
    let n = 0;
    return (
      <div className="fill-blanks" role="group" aria-label={`${label}: ${item.prompt || 'Choose the correct words'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="cloze preserve-lines">
          {item.segments.map((s, i) => {
            if (s.kind === 'text') return <Fragment key={i}>{s.text}</Fragment>;
            n++;
            const part = parts.get(s.id);
            return (
              <span key={s.id} className="blank-wrap">
                <select
                  className={`blank-select ${part ? (part.correct ? 'is-correct' : 'is-wrong') : ''}`}
                  aria-label={`Gap ${n} of ${blanks.length}`}
                  aria-invalid={part ? !part.correct : undefined}
                  disabled={disabled}
                  value={response.values[s.id] ?? ''}
                  onChange={(e) => onChange({ values: { ...response.values, [s.id]: e.target.value } })}
                >
                  <option value="">Choose…</option>
                  {options.get(s.id)!.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {showKey && <span className="badge key">{s.answers[0]}</span>}
              </span>
            );
          })}
        </p>
      </div>
    );
  },
};
