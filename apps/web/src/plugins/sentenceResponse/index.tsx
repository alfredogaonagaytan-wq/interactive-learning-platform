import { useId, useMemo, useState } from 'react';
import {
  expandPattern, getItemDefinition, GRAMMAR_CATEGORIES, patternProblem, randomId, TASK_LABELS,
  type SentenceResponseItem, type SentenceResponseResponse,
} from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextArea, TextField } from '../../ui/fields';
import { LinesField, RowControls, moveInArray } from '../../ui/lists';
import type { ItemPlugin } from '../types';

const TASK_PROMPTS: Record<SentenceResponseItem['task'], string> = {
  transform: 'Rewrite the sentence in the passive voice.',
  correct: 'Find the mistake and write the sentence correctly.',
  combine: 'Combine the two sentences using “because”.',
  complete: 'Complete the sentence.',
  answer: 'Answer in a full sentence.',
};

function PatternPreview({ item }: { item: SentenceResponseItem }) {
  const problem = patternProblem(item.accepted);
  const all = useMemo(() => (problem ? [] : item.accepted.flatMap((p) => (p.trim() ? expandPattern(p) : []))), [item.accepted, problem]);
  if (problem) return <p className="notice error" role="alert">{problem}</p>;
  return (
    <details className="subpanel">
      <summary>{all.length} accepted sentence{all.length === 1 ? '' : 's'} (preview)</summary>
      <ul className="pattern-list">{all.slice(0, 40).map((s) => <li key={s}>{s}</li>)}</ul>
      {all.length > 40 && <p className="field-hint">…and {all.length - 40} more.</p>}
    </details>
  );
}

function AnswerTester({ item, language }: { item: SentenceResponseItem; language: string }) {
  const [text, setText] = useState('');
  const r = text.trim() ? getItemDefinition('sentence-response').grade(item, { text }, { language }) : null;
  const label = r && { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', 'needs-review': 'Sent to you for review', unanswered: 'No answer', ungraded: '' }[r.status];
  return (
    <div className="tester">
      <TextField label="Try a student answer" value={text} onChange={setText} placeholder="Type a possible answer to see how it would be graded" />
      {r && (
        <p className={`feedback fb-${r.status === 'needs-review' ? 'partial' : r.status}`} role="status">
          <strong>{label}</strong> — {r.score} / {r.maxScore}
          {r.errorTags?.length ? <> · error type: {r.errorTags.join(', ')}</> : null}
          {r.feedback && <><br />{r.feedback}</>}
        </p>
      )}
    </div>
  );
}

export const sentenceResponsePlugin: ItemPlugin<SentenceResponseItem, SentenceResponseResponse> = {
  type: 'sentence-response',
  label: 'Sentence (grammar)',
  description: 'Transform, correct, combine or complete a sentence. Graded by your accepted patterns and mistake rules.',
  Editor({ item, onChange, language }) {
    const listId = useId();
    const setRule = (i: number, patch: Partial<SentenceResponseItem['errorRules'][number]>) => onChange({ ...item, errorRules: item.errorRules.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
    return (
      <>
        <Select
          label="Task"
          value={item.task}
          onChange={(task) => onChange({ ...item, task, prompt: Object.values(TASK_PROMPTS).includes(item.prompt) || !item.prompt ? TASK_PROMPTS[task] : item.prompt })}
          options={(Object.keys(TASK_LABELS) as Array<SentenceResponseItem['task']>).map((k) => ({ value: k, label: TASK_LABELS[k] }))}
        />
        <TextArea label="Instructions" rows={2} value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <TextArea label={item.task === 'correct' ? 'Sentence with the mistake' : item.task === 'combine' ? 'Sentences to combine' : 'Sentence shown to students (optional)'} rows={2} value={item.source} onChange={(source) => onChange({ ...item, source })} />
        <TextField label="Start of the answer (optional, pre-filled)" value={item.starter} onChange={(starter) => onChange({ ...item, starter })} />
        <LinesField
          label="Accepted answers, one pattern per line"
          value={item.accepted}
          onChange={(accepted) => onChange({ ...item, accepted: accepted.length ? accepted : [''] })}
          hint={<>Use <code>{'{a|b}'}</code> for alternatives and <code>{'{word |}'}</code> for optional words, e.g. <code>{"She {has|'s} {already |}finished."}</code></>}
        />
        <PatternPreview item={item} />
        <fieldset>
          <legend>Common mistakes (optional)</legend>
          <p className="field-hint">Describe a typical wrong answer, its error type and the feedback students should get.</p>
          <datalist id={listId}>{GRAMMAR_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          {item.errorRules.map((r, i) => (
            <div key={r.id} className="rule-row">
              <input type="text" aria-label={`Mistake ${i + 1} pattern`} placeholder="The report {was wrote|was writed}." value={r.pattern} onChange={(e) => setRule(i, { pattern: e.target.value })} />
              <input type="text" aria-label={`Mistake ${i + 1} error type`} list={listId} placeholder="Error type" value={r.errorType} onChange={(e) => setRule(i, { errorType: e.target.value })} />
              <input type="text" aria-label={`Mistake ${i + 1} feedback`} placeholder="Feedback for this mistake" value={r.feedback} onChange={(e) => setRule(i, { feedback: e.target.value })} />
              <RowControls index={i} count={item.errorRules.length} label={`mistake ${i + 1}`} onMove={(a, b) => onChange({ ...item, errorRules: moveInArray(item.errorRules, a, b) })} onRemove={() => onChange({ ...item, errorRules: item.errorRules.filter((_, k) => k !== i) })} />
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => onChange({ ...item, errorRules: [...item.errorRules, { id: randomId('chc'), pattern: '', errorType: '', feedback: '' }] })}>+ Add common mistake</button>
        </fieldset>
        <fieldset>
          <legend>Meaning (optional)</legend>
          <LinesField
            label="Words or ideas the answer must contain, one per line (alternatives with |)"
            value={item.keywords.map((k) => k.forms.join(' | '))}
            onChange={(lines) => onChange({ ...item, keywords: lines.map((l, i) => ({ id: item.keywords[i]?.id ?? randomId('chc'), forms: l.split('|').map((x) => x.trim()).filter(Boolean) })).filter((k) => k.forms.length) })}
          />
          {item.keywords.length > 0 && (
            <NumberField label="Share of points for meaning (%)" value={Math.round(item.meaningWeight * 100)} min={0} max={100} step={5} onChange={(v) => onChange({ ...item, meaningWeight: (v ?? 0) / 100 })} hint="An answer with the right meaning but a grammar mistake gets this share." />
          )}
        </fieldset>
        <Checkbox label="Capitalization must match" checked={item.match.caseSensitive} onChange={(caseSensitive) => onChange({ ...item, match: { ...item.match, caseSensitive } })} />
        <Checkbox label="Punctuation must match" checked={item.match.punctuationSensitive} onChange={(punctuationSensitive) => onChange({ ...item, match: { ...item.match, punctuationSensitive } })} />
        <Select label="Answers that match no pattern" value={item.unmatched} onChange={(unmatched) => onChange({ ...item, unmatched })} options={[
          { value: 'review', label: 'Send to me for review (recommended)' },
          { value: 'incorrect', label: 'Mark incorrect' },
        ]} hint="Many sentences can be correct in more than one way. Review keeps unexpected but correct answers from losing marks." />
        <AnswerTester item={item} language={language} />
        <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, label }) {
    const id = useId();
    return (
      <div className="sentence-response">
        <p className="prompt"><span className="sr-only">{label}: </span>{item.prompt}</p>
        {item.source && <blockquote className="source-sentence preserve-lines">{item.source}</blockquote>}
        <label htmlFor={id} className="label-text">{TASK_LABELS[item.task]}</label>
        <textarea id={id} rows={2} disabled={disabled} value={response.text} spellCheck={false} onChange={(e) => onChange({ text: e.target.value })} aria-invalid={result ? result.status === 'incorrect' : undefined} />
        {result?.errorTags?.length ? <p className="meta">Error type: {result.errorTags.join(', ')}</p> : null}
        {showKey && <p className="badge key">{item.accepted.join(' · ')}</p>}
      </div>
    );
  },
};
