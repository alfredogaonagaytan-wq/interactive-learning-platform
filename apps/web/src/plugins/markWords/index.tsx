import { Fragment, useMemo } from 'react';
import { tokenizeMarkWords, type MarkWordsItem, type MarkWordsResponse } from '@ilp/core';
import { FeedbackFields, NumberField, SkillsField, TextArea, TextField } from '../../ui/fields';
import type { ItemPlugin } from '../types';

export const markWordsPlugin: ItemPlugin<MarkWordsItem, MarkWordsResponse> = {
  type: 'mark-words',
  label: 'Mark the words',
  description: 'Students click words in a text (e.g. all the verbs, all the adjectives).',
  Editor({ item, onChange }) {
    const targets = useMemo(() => tokenizeMarkWords(item.text).filter((t) => t.kind === 'word' && t.correct), [item.text]);
    return (
      <>
        <TextField label="Task" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <TextArea
          label="Text"
          rows={6}
          mono
          value={item.text}
          onChange={(text) => onChange({ ...item, text })}
          placeholder="The volcano *erupted* and lava *flowed* down the mountain."
          hint={<>Wrap each correct word in <kbd>*asterisks*</kbd>. Wrong clicks cancel right ones (score never goes below zero).</>}
        />
        <p className="field-hint" aria-live="polite">{targets.length} word{targets.length === 1 ? '' : 's'} to find: {targets.map((t) => t.text).join(', ') || '—'}</p>
        <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, label }) {
    const tokens = useMemo(() => tokenizeMarkWords(item.text), [item.text]);
    const selected = new Set(response.selected);
    const checked = !!result;
    return (
      <div className="mark-words" role="group" aria-label={`${label}: ${item.prompt || 'Mark the words'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="instruction">Click or tap words to select them. Click again to unselect.</p>
        <p className="mark-text preserve-lines">
          {tokens.map((t, i) => {
            if (t.kind === 'text') return <Fragment key={i}>{t.text}</Fragment>;
            const isSel = selected.has(t.index);
            const state = checked && isSel ? (t.correct ? 'is-correct' : 'is-wrong') : '';
            return (
              <button
                key={i}
                type="button"
                className={`mark-word ${isSel ? 'is-selected' : ''} ${state} ${showKey && t.correct ? 'is-key' : ''}`}
                aria-pressed={isSel}
                disabled={disabled}
                onClick={() => onChange({ selected: isSel ? response.selected.filter((x) => x !== t.index) : [...response.selected, t.index] })}
              >
                {t.text}
                {checked && isSel && <span className="sr-only">{t.correct ? ' (correct)' : ' (incorrect)'}</span>}
              </button>
            );
          })}
        </p>
      </div>
    );
  },
};
