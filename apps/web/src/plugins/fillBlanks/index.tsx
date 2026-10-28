import { Fragment, useState } from 'react';
import { blanksOf, parseBlankMarkup, randomId, serializeBlankMarkup, type FillBlanksItem, type FillBlanksResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextArea, TextField } from '../../ui/fields';
import type { ItemPlugin } from '../types';

function EquivalencesEditor({ value, onChange }: { value: string[][]; onChange: (v: string[][]) => void }) {
  return (
    <fieldset className="subfieldset">
      <legend>Equivalent forms</legend>
      <p className="field-hint">Treat these as the same everywhere in this question, e.g. “do not” = “don’t”. Separate forms with “=”.</p>
      {value.map((group, i) => (
        <div className="row" key={i}>
          <input type="text" aria-label={`Equivalence ${i + 1}`} defaultValue={group.join(' = ')} onBlur={(e) => {
            const forms = e.target.value.split('=').map((s) => s.trim()).filter(Boolean);
            const next = [...value];
            if (forms.length >= 2) next[i] = forms;
            else next.splice(i, 1);
            onChange(next);
          }} />
          <button type="button" className="icon danger" aria-label={`Remove equivalence ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <AddEquivalence onAdd={(forms) => onChange([...value, forms])} />
    </fieldset>
  );
}

function AddEquivalence({ onAdd }: { onAdd: (forms: string[]) => void }) {
  const [text, setText] = useState('');
  const forms = text.split('=').map((s) => s.trim()).filter(Boolean);
  return (
    <div className="row">
      <input type="text" aria-label="New equivalence" placeholder="do not = don't" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="secondary" disabled={forms.length < 2} onClick={() => { onAdd(forms); setText(''); }}>Add</button>
    </div>
  );
}

export const fillBlanksPlugin: ItemPlugin<FillBlanksItem, FillBlanksResponse> = {
  type: 'fill-blanks',
  label: 'Fill in the blanks',
  description: 'Students type missing words. Several accepted answers per blank.',
  Editor({ item, onChange }) {
    const [markup, setMarkup] = useState(() => serializeBlankMarkup(item.segments));
    const blanks = blanksOf(item);
    const setBlankHint = (id: string, hint: string) =>
      onChange({ ...item, segments: item.segments.map((s) => (s.kind === 'blank' && s.id === id ? (hint ? { ...s, hint } : { kind: 'blank', id: s.id, answers: s.answers }) : s)) });
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <TextArea
          label="Text with blanks"
          rows={5}
          mono
          value={markup}
          onChange={(t) => {
            setMarkup(t);
            onChange({ ...item, segments: parseBlankMarkup(t, item.segments, () => randomId('blk')) });
          }}
          placeholder="Yesterday she [went] to the market and [bought | purchased] apples."
          hint={<>Put each answer in <kbd>[square brackets]</kbd>. Separate other accepted answers with <kbd>|</kbd>, e.g. <code>[went | was going]</code>.</>}
        />
        <div className="blank-list" aria-live="polite">
          <h4>{blanks.length} blank{blanks.length === 1 ? '' : 's'} found</h4>
          {blanks.length === 0 && <p className="field-hint">No blanks yet.</p>}
          <ol>
            {blanks.map((b) => (
              <li key={b.id}>
                <span className="accepted">{b.answers.map((a, i) => <Fragment key={i}>{i > 0 && <span className="or"> or </span>}<mark>{a}</mark></Fragment>)}</span>
                <input type="text" aria-label={`Hint for blank “${b.answers[0]}”`} placeholder="Hint (optional)" value={b.hint ?? ''} onChange={(e) => setBlankHint(b.id, e.target.value)} />
              </li>
            ))}
          </ol>
        </div>
        <fieldset className="subfieldset">
          <legend>Answer matching</legend>
          <Checkbox label="Capitalization must match" checked={item.match.caseSensitive} onChange={(caseSensitive) => onChange({ ...item, match: { ...item.match, caseSensitive } })} />
          <Checkbox label="Punctuation must match" checked={item.match.punctuationSensitive} onChange={(punctuationSensitive) => onChange({ ...item, match: { ...item.match, punctuationSensitive } })} />
          <Checkbox label="Accents must match (é ≠ e)" checked={item.match.accentSensitive} onChange={(accentSensitive) => onChange({ ...item, match: { ...item.match, accentSensitive } })} />
          <p className="field-hint">Extra spaces and curly vs straight quotes are always ignored. When an answer is wrong only because of capitalization, punctuation or accents, students are told so — but get no credit for it.</p>
        </fieldset>
        <EquivalencesEditor value={item.match.equivalences} onChange={(equivalences) => onChange({ ...item, match: { ...item.match, equivalences } })} />
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[{ value: 'per-blank', label: 'Share points between blanks' }, { value: 'all-or-nothing', label: 'All blanks must be correct' }]} />
        </div>
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, label }) {
    const blanks = blanksOf(item);
    const size = Math.min(30, Math.max(8, ...blanks.flatMap((b) => b.answers.map((a) => a.length + 2))));
    const parts = new Map(result?.parts.map((p) => [p.partId, p]));
    let n = 0;
    return (
      <div className="fill-blanks" role="group" aria-label={`${label}: ${item.prompt || 'Fill in the blanks'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="cloze preserve-lines">
          {item.segments.map((s, i) => {
            if (s.kind === 'text') return <Fragment key={i}>{s.text}</Fragment>;
            n++;
            const part = parts.get(s.id);
            const cls = part ? (part.correct ? 'is-correct' : 'is-wrong') : '';
            return (
              <span key={s.id} className="blank-wrap">
                <input
                  type="text"
                  className={`blank ${cls}`}
                  size={size}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label={`Blank ${n} of ${blanks.length}${s.hint ? `. Hint: ${s.hint}` : ''}`}
                  aria-invalid={part ? !part.correct : undefined}
                  title={s.hint}
                  disabled={disabled}
                  value={response.values[s.id] ?? ''}
                  onChange={(e) => onChange({ values: { ...response.values, [s.id]: e.target.value } })}
                />
                {part && <span className="sr-only">{part.correct ? 'correct' : 'incorrect'}</span>}
                {showKey && <span className="badge key">{s.answers.join(' / ')}</span>}
              </span>
            );
          })}
        </p>
      </div>
    );
  },
};
