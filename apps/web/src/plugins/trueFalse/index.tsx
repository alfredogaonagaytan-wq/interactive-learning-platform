import { useId } from 'react';
import type { TrueFalseItem, TrueFalseResponse } from '@ilp/core';
import { FeedbackFields, NumberField, Select, SkillsField, TextArea, TextField } from '../../ui/fields';
import type { ItemPlugin } from '../types';

export const trueFalsePlugin: ItemPlugin<TrueFalseItem, TrueFalseResponse> = {
  type: 'true-false',
  label: 'True / false',
  description: 'A statement students judge as true or false (labels can be changed).',
  Editor({ item, onChange }) {
    return (
      <>
        <TextArea label="Statement" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <Select label="Correct answer" value={item.correct ? 'true' : 'false'} onChange={(v) => onChange({ ...item, correct: v === 'true' })} options={[{ value: 'true', label: item.trueLabel || 'True' }, { value: 'false', label: item.falseLabel || 'False' }]} />
        <div className="grid-2">
          <TextField label="Label for “true”" value={item.trueLabel} onChange={(trueLabel) => onChange({ ...item, trueLabel })} />
          <TextField label="Label for “false”" value={item.falseLabel} onChange={(falseLabel) => onChange({ ...item, falseLabel })} />
        </div>
        <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, label }) {
    const name = useId();
    const opt = (v: boolean, text: string) => {
      const isSel = response.value === v;
      const state = result && isSel ? (v === item.correct ? 'is-correct' : 'is-wrong') : '';
      return (
        <label className={`choice ${isSel ? 'is-selected' : ''} ${state} ${showKey && v === item.correct ? 'is-key' : ''}`}>
          <input type="radio" name={name} checked={isSel} disabled={disabled} onChange={() => onChange({ value: v })} />
          <span className="choice-text">{text}</span>
          {showKey && v === item.correct && <span className="badge key">Answer key</span>}
        </label>
      );
    };
    return (
      <fieldset className="mc tf">
        <legend>
          <span className="sr-only">{label}: </span>
          <span className="preserve-lines">{item.prompt}</span>
        </legend>
        <div className="tf-options">
          {opt(true, item.trueLabel)}
          {opt(false, item.falseLabel)}
        </div>
      </fieldset>
    );
  },
};
