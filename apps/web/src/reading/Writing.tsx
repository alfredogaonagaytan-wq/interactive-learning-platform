import { useId, useRef } from 'react';
import { countWords, FRAMEWORK_PRESETS, randomId, rubricMax, writingChecks, type RubricCriterion, type WritingResponse, type WritingTask } from '@ilp/core';
import { Checkbox, NumberField, Select, TextArea, TextField } from '../ui/fields';
import { LinesField, RowControls, moveInArray } from '../ui/lists';

export interface EvidenceOption {
  id: string;
  label: string;
  /** Text inserted into the writing, e.g. “quote” (¶3). */
  insert: string;
}

/** Student writing panel: guided sections, sentence starters, evidence insertion, live checklist, success criteria and rubric. */
export function WritingPanel({ task, value, onChange, disabled, evidence = [] }: { task: WritingTask; value: WritingResponse; onChange: (v: WritingResponse) => void; disabled: boolean; evidence?: EvidenceOption[] }) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const baseId = useId();
  const checks = writingChecks(task, value);
  const setSection = (id: string, text: string) => onChange({ ...value, sections: { ...value.sections, [id]: text } });
  const insertAt = (id: string, text: string) => {
    const el = refs.current[id];
    const cur = value.sections[id] ?? '';
    const pos = el?.selectionStart ?? cur.length;
    const before = cur.slice(0, pos);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    setSection(id, `${before}${sep}${text}${cur.slice(pos)}`);
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <div className="writing-panel">
      {task.prompt && <p className="writing-prompt preserve-lines">{task.prompt}</p>}
      {task.successCriteria.length > 0 && (
        <fieldset className="success-criteria">
          <legend>Success criteria</legend>
          {task.successCriteria.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" disabled={disabled} checked={!!value.successChecks[c.id]} onChange={(e) => onChange({ ...value, successChecks: { ...value.successChecks, [c.id]: e.target.checked } })} /> {c.text}
            </label>
          ))}
        </fieldset>
      )}
      {task.sections.map((s) => {
        const id = `${baseId}-${s.id}`;
        const words = countWords(value.sections[s.id] ?? '');
        return (
          <section key={s.id} className="writing-section" aria-labelledby={`${id}-l`}>
            <h4 id={`${id}-l`}>{s.label}</h4>
            {s.guidance && <p className="field-hint" id={`${id}-g`}>{s.guidance}</p>}
            {!disabled && (s.starters.length > 0 || evidence.length > 0) && (
              <div className="row wrap starters">
                {s.starters.map((st) => <button key={st} type="button" className="ghost small" onClick={() => insertAt(s.id, st)}>+ {st}</button>)}
                {evidence.length > 0 && (
                  <select aria-label={`Insert evidence into ${s.label}`} value="" onChange={(e) => { const ev = evidence.find((x) => x.id === e.target.value); if (ev) insertAt(s.id, ev.insert); }}>
                    <option value="">Insert evidence from my notes…</option>
                    {evidence.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                  </select>
                )}
              </div>
            )}
            <textarea
              id={id}
              ref={(el) => { refs.current[s.id] = el; }}
              rows={4}
              disabled={disabled}
              aria-labelledby={`${id}-l`}
              aria-describedby={s.guidance ? `${id}-g` : undefined}
              value={value.sections[s.id] ?? ''}
              onChange={(e) => setSection(s.id, e.target.value)}
            />
            <p className={`meta word-count ${s.minWords && words < s.minWords ? 'short' : ''}`}>{words} word{words === 1 ? '' : 's'}{s.minWords ? ` (at least ${s.minWords})` : ''}</p>
          </section>
        );
      })}
      {checks.length > 0 && (
        <div className="checklist" aria-live="polite">
          <h4>Checklist</h4>
          <ul>{checks.map((c) => <li key={c.id} className={c.met ? 'met' : 'unmet'}><span aria-hidden="true">{c.met ? '✓' : '○'}</span> {c.label} <span className="meta">— {c.detail}</span><span className="sr-only">{c.met ? ' (done)' : ' (not yet)'}</span></li>)}</ul>
          <p className="field-hint">The checklist only checks length, citations and required words. Your teacher assesses the quality.</p>
        </div>
      )}
      {task.rubric.length > 0 && <RubricView rubric={task.rubric} self={task.rubricSelfAssessment && !disabled ? value.rubricSelf : null} onSelf={(c, l) => onChange({ ...value, rubricSelf: { ...value.rubricSelf, [c]: l } })} />}
    </div>
  );
}

export function RubricView({ rubric, self, onSelf }: { rubric: RubricCriterion[]; self: Record<string, string> | null; onSelf: (criterionId: string, levelId: string) => void }) {
  const name = useId();
  return (
    <div className="rubric">
      <h4>Rubric ({rubricMax(rubric)} points){self && ' — rate yourself'}</h4>
      <div className="r-table-wrap">
        <table className="rubric-table">
          <thead><tr><th scope="col">Criterion</th>{rubric[0]?.levels.map((l, i) => <th key={i} scope="col">{rubric.every((c) => c.levels[i]?.label === l.label) ? l.label : `Level ${i + 1}`}</th>)}</tr></thead>
          <tbody>
            {rubric.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.label}</th>
                {c.levels.map((l) => (
                  <td key={l.id} className={self?.[c.id] === l.id ? 'is-self' : ''}>
                    <span className="rubric-pts">{l.label} · {l.points} pt{l.points === 1 ? '' : 's'}</span>
                    {l.descriptor && <span className="rubric-desc">{l.descriptor}</span>}
                    {self && (
                      <label className="check small-check"><input type="radio" name={`${name}-${c.id}`} checked={self[c.id] === l.id} onChange={() => onSelf(c.id, l.id)} /> <span className="sr-only">{c.label}: </span>This is me</label>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LEVELS = () => [
  { id: randomId('rub'), label: 'Beginning', points: 1, descriptor: '' },
  { id: randomId('rub'), label: 'Developing', points: 2, descriptor: '' },
  { id: randomId('rub'), label: 'Secure', points: 3, descriptor: '' },
  { id: randomId('rub'), label: 'Exceeding', points: 4, descriptor: '' },
];

/** Teacher editor for a writing framework, requirements, success criteria and rubric. */
export function WritingTaskEditor({ task, onChange }: { task: WritingTask; onChange: (t: WritingTask) => void }) {
  const setSec = (i: number, patch: Partial<WritingTask['sections'][number]>) => onChange({ ...task, sections: task.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setCrit = (i: number, c: RubricCriterion) => onChange({ ...task, rubric: task.rubric.map((x, k) => (k === i ? c : x)) });
  return (
    <div className="writing-editor">
      <Select
        label="Framework"
        value={task.framework}
        onChange={(framework) => onChange({ ...task, framework, sections: framework === 'custom' ? task.sections : FRAMEWORK_PRESETS[framework].sections() })}
        options={[...(Object.keys(FRAMEWORK_PRESETS) as Array<keyof typeof FRAMEWORK_PRESETS>).map((k) => ({ value: k, label: FRAMEWORK_PRESETS[k].label })), { value: 'custom', label: 'My own framework' }]}
        hint="Choosing a preset replaces the sections below. Every preset can be edited."
      />
      <TextArea label="Writing prompt" rows={2} value={task.prompt} onChange={(prompt) => onChange({ ...task, prompt })} placeholder="Using evidence from the text, explain how ocean acidification affects shellfish." />
      <fieldset>
        <legend>Sections</legend>
        {task.sections.map((s, i) => (
          <div key={s.id} className="section-edit">
            <div className="row">
              <input type="text" aria-label={`Section ${i + 1} name`} value={s.label} onChange={(e) => setSec(i, { label: e.target.value })} />
              <RowControls index={i} count={task.sections.length} label={`section ${i + 1}`} minCount={1} onMove={(a, b) => onChange({ ...task, framework: 'custom', sections: moveInArray(task.sections, a, b) })} onRemove={() => onChange({ ...task, framework: 'custom', sections: task.sections.filter((_, k) => k !== i) })} />
            </div>
            <input type="text" aria-label={`Section ${i + 1} guidance`} placeholder="Guidance for students" value={s.guidance} onChange={(e) => setSec(i, { guidance: e.target.value })} />
            <LinesField label={`Section ${i + 1} sentence starters (one per line)`} value={s.starters} onChange={(starters) => setSec(i, { starters })} />
            <NumberField label="Minimum words" value={s.minWords} min={0} max={5000} onChange={(v) => setSec(i, { minWords: v ?? 0 })} />
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => onChange({ ...task, framework: 'custom', sections: [...task.sections, { id: randomId('sec'), label: 'New section', guidance: '', starters: [], minWords: 0 }] })}>+ Add section</button>
      </fieldset>
      <fieldset>
        <legend>Automatic checks (structure only)</legend>
        <NumberField label="Paragraph citations required, e.g. (¶3)" value={task.minCitations} min={0} max={50} onChange={(v) => onChange({ ...task, minCitations: v ?? 0 })} />
        <LinesField label="Terms the writing must use (one per line)" value={task.requiredTerms} onChange={(requiredTerms) => onChange({ ...task, requiredTerms })} />
      </fieldset>
      <LinesField label="Success criteria (“I can…”), one per line" value={task.successCriteria.map((c) => c.text)} onChange={(lines) => onChange({ ...task, successCriteria: lines.map((text, i) => ({ id: task.successCriteria[i]?.id ?? randomId('sec'), text })) })} />
      <fieldset>
        <legend>Rubric (teacher-assessed)</legend>
        {task.rubric.map((c, i) => (
          <div key={c.id} className="criterion-edit">
            <div className="row">
              <input type="text" aria-label={`Criterion ${i + 1} name`} value={c.label} placeholder="e.g. Use of evidence" onChange={(e) => setCrit(i, { ...c, label: e.target.value })} />
              <RowControls index={i} count={task.rubric.length} label={`criterion ${i + 1}`} onMove={(a, b) => onChange({ ...task, rubric: moveInArray(task.rubric, a, b) })} onRemove={() => onChange({ ...task, rubric: task.rubric.filter((_, k) => k !== i) })} />
            </div>
            <div className="level-grid">
              {c.levels.map((l, j) => (
                <div key={l.id} className="level-edit">
                  <input type="text" aria-label={`Criterion ${i + 1} level ${j + 1} name`} value={l.label} onChange={(e) => setCrit(i, { ...c, levels: c.levels.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
                  <input type="number" aria-label={`Criterion ${i + 1} level ${j + 1} points`} min={0} max={100} value={l.points} onChange={(e) => { const n = e.target.valueAsNumber; if (!Number.isNaN(n)) setCrit(i, { ...c, levels: c.levels.map((x, k) => (k === j ? { ...x, points: n } : x)) }); }} />
                  <textarea aria-label={`Criterion ${i + 1} level ${j + 1} description`} rows={2} placeholder="What this looks like" value={l.descriptor} onChange={(e) => setCrit(i, { ...c, levels: c.levels.map((x, k) => (k === j ? { ...x, descriptor: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => onChange({ ...task, rubric: [...task.rubric, { id: randomId('rub'), label: '', levels: LEVELS() }] })}>+ Add criterion</button>
        {task.rubric.length > 0 && <Checkbox label="Let students rate themselves on the rubric" checked={task.rubricSelfAssessment} onChange={(rubricSelfAssessment) => onChange({ ...task, rubricSelfAssessment })} />}
        <p className="field-hint">Rubric scores are given by you (teacher review); students see the rubric while writing. Review and scoring of submissions arrives with Phase 6.</p>
      </fieldset>
    </div>
  );
}
