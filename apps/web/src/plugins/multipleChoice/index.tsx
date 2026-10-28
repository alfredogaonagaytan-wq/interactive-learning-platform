import { useId, useMemo } from 'react';
import { randomId, type MultipleChoiceItem, type MultipleChoiceResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextArea } from '../../ui/fields';
import { seededShuffle } from '../../app/util';
import type { ItemPlugin } from '../types';

export const multipleChoicePlugin: ItemPlugin<MultipleChoiceItem, MultipleChoiceResponse> = {
  type: 'multiple-choice',
  label: 'Multiple choice',
  description: 'One or several correct answers, with optional per-choice feedback.',
  Editor({ item, onChange }) {
    const setChoice = (idx: number, patch: Partial<MultipleChoiceItem['choices'][number]>) => {
      const choices = item.choices.map((c, i) => {
        if (i === idx) return { ...c, ...patch };
        // In single mode, marking one correct unmarks the others.
        if (patch.correct && item.mode === 'single') return { ...c, correct: false };
        return c;
      });
      onChange({ ...item, choices });
    };
    const move = (idx: number, d: -1 | 1) => {
      const choices = [...item.choices];
      const j = idx + d;
      if (j < 0 || j >= choices.length) return;
      [choices[idx], choices[j]] = [choices[j]!, choices[idx]!];
      onChange({ ...item, choices });
    };
    return (
      <>
        <TextArea label="Question" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <Select
          label="Answer type"
          value={item.mode}
          onChange={(mode) => onChange({ ...item, mode, choices: mode === 'single' ? keepFirstCorrect(item.choices) : item.choices })}
          options={[
            { value: 'single', label: 'One correct answer (radio buttons)' },
            { value: 'multiple', label: 'Several correct answers (checkboxes)' },
          ]}
        />
        <fieldset className="choices-editor">
          <legend>Choices — tick the correct answer{item.mode === 'multiple' ? 's' : ''}</legend>
          {item.choices.map((c, i) => (
            <div className="choice-row" key={c.id}>
              <label className="check correct-toggle">
                <input type={item.mode === 'single' ? 'radio' : 'checkbox'} name={`correct-${item.id}`} checked={c.correct} onChange={(e) => setChoice(i, { correct: e.target.checked })} />
                <span className="sr-only">Choice {i + 1} is correct</span>
              </label>
              <input type="text" aria-label={`Choice ${i + 1} text`} value={c.text} placeholder={`Choice ${i + 1}`} onChange={(e) => setChoice(i, { text: e.target.value })} />
              <input type="text" aria-label={`Choice ${i + 1} feedback`} className="choice-feedback" value={c.feedback ?? ''} placeholder="Feedback if chosen (optional)" onChange={(e) => setChoice(i, { feedback: e.target.value || undefined })} />
              <div className="icon-buttons">
                <button type="button" className="icon" aria-label={`Move choice ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="icon" aria-label={`Move choice ${i + 1} down`} disabled={i === item.choices.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="icon danger" aria-label={`Remove choice ${i + 1}`} disabled={item.choices.length <= 2} onClick={() => onChange({ ...item, choices: item.choices.filter((_, k) => k !== i) })}>×</button>
              </div>
            </div>
          ))}
          <button type="button" className="secondary" disabled={item.choices.length >= 20} onClick={() => onChange({ ...item, choices: [...item.choices, { id: randomId('chc'), text: '', correct: false }] })}>
            + Add choice
          </button>
        </fieldset>
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          {item.mode === 'multiple' && (
            <Select
              label="Scoring"
              value={item.scoring}
              onChange={(scoring) => onChange({ ...item, scoring })}
              options={[
                { value: 'all-or-nothing', label: 'All or nothing' },
                { value: 'partial', label: 'Partial credit (wrong picks subtract)' },
              ]}
            />
          )}
        </div>
        <Checkbox label="Shuffle choices for each student" checked={item.shuffleChoices} onChange={(shuffleChoices) => onChange({ ...item, shuffleChoices })} />
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const name = useId();
    const choices = useMemo(() => (item.shuffleChoices ? seededShuffle(item.choices, seed + item.id) : item.choices), [item, seed]);
    const selected = new Set(response.choiceIds);
    const partById = new Map(result?.parts.map((p) => [p.partId, p]));
    return (
      <fieldset className="mc">
        <legend>
          <span className="sr-only">{label}: </span>
          <span className="preserve-lines">{item.prompt}</span>
          {item.mode === 'multiple' && <span className="instruction"> Select all that apply.</span>}
        </legend>
        {choices.map((c) => {
          const part = partById.get(c.id);
          const isSel = selected.has(c.id);
          const state = result && isSel ? (c.correct ? 'is-correct' : 'is-wrong') : result && part?.reason === 'missed-choice' && showKey ? 'is-missed' : '';
          return (
            <label key={c.id} className={`choice ${isSel ? 'is-selected' : ''} ${state} ${showKey && c.correct ? 'is-key' : ''}`}>
              <input
                type={item.mode === 'single' ? 'radio' : 'checkbox'}
                name={name}
                checked={isSel}
                disabled={disabled}
                onChange={(e) => {
                  if (item.mode === 'single') onChange({ choiceIds: [c.id] });
                  else onChange({ choiceIds: e.target.checked ? [...response.choiceIds, c.id] : response.choiceIds.filter((x) => x !== c.id) });
                }}
              />
              <span className="choice-text">{c.text}</span>
              {showKey && c.correct && <span className="badge key">Answer key</span>}
              {result && isSel && <span className="sr-only">{c.correct ? ' (correct)' : ' (incorrect)'}</span>}
              {result && isSel && c.feedback && <span className="choice-fb">{c.feedback}</span>}
            </label>
          );
        })}
      </fieldset>
    );
  },
};

function keepFirstCorrect(choices: MultipleChoiceItem['choices']) {
  let seen = false;
  return choices.map((c) => {
    if (c.correct && !seen) {
      seen = true;
      return c;
    }
    return { ...c, correct: false };
  });
}
