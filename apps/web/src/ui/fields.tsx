import { useId, useState, type ReactNode } from 'react';
import type { Feedback } from '@ilp/core';

interface Base {
  label: string;
  hint?: ReactNode;
}

export function TextField({ label, hint, value, onChange, placeholder, required }: Base & { value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <p id={`${id}-h`} className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextArea({ label, hint, value, onChange, rows = 3, placeholder, mono }: Base & { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={rows} value={value} placeholder={placeholder} className={mono ? 'mono' : undefined} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <div id={`${id}-h`} className="field-hint">{hint}</div>}
    </div>
  );
}

export function NumberField({ label, hint, value, onChange, min, max, step = 1, nullable, nullLabel = 'Unlimited' }: Base & { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; nullable?: boolean; nullLabel?: string }) {
  const id = useId();
  return (
    <div className="field field-inline">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          disabled={nullable && value === null}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (!Number.isNaN(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
          }}
        />
        {nullable && (
          <label className="check">
            <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : (min ?? 1))} /> {nullLabel}
          </label>
        )}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Checkbox({ label, hint, checked, onChange }: Base & { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({ label, hint, value, onChange, options }: Base & { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/** Comma-separated skill tags, e.g. "past simple, irregular verbs". */
export function SkillsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <TextField
      label="Skills assessed"
      hint="Comma-separated. Used in reports, e.g. “past simple, irregular verbs”."
      value={text}
      onChange={(t) => {
        setText(t);
        onChange([...new Set(t.split(',').map((s) => s.trim()).filter(Boolean))]);
      }}
    />
  );
}

export function FeedbackFields({ value, onChange, hint = true }: { value: Feedback; onChange: (v: Feedback) => void; hint?: boolean }) {
  const set = (k: keyof Feedback) => (v: string) => {
    const next = { ...value };
    if (v) next[k] = v;
    else delete next[k];
    onChange(next);
  };
  return (
    <details className="subpanel">
      <summary>Feedback, hint and explanation</summary>
      <TextField label="Feedback when correct" value={value.correct ?? ''} onChange={set('correct')} />
      <TextField label="Feedback when incorrect" value={value.incorrect ?? ''} onChange={set('incorrect')} />
      {hint && <TextField label="Hint (students can reveal it)" value={value.hint ?? ''} onChange={set('hint')} />}
      <TextArea label="Explanation (shown with results)" rows={2} value={value.explanation ?? ''} onChange={set('explanation')} />
    </details>
  );
}
