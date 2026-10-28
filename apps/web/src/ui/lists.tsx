import type { ReactNode } from 'react';

/** Up / down / remove buttons for authoring lists (keyboard alternative to drag-reordering). */
export function RowControls({ index, count, label, onMove, onRemove, minCount = 0 }: { index: number; count: number; label: string; onMove: (from: number, to: number) => void; onRemove: () => void; minCount?: number }) {
  return (
    <div className="icon-buttons">
      <button type="button" className="icon" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>↑</button>
      <button type="button" className="icon" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>↓</button>
      <button type="button" className="icon danger" aria-label={`Remove ${label}`} disabled={count <= minCount} onClick={onRemove}>×</button>
    </div>
  );
}

export function moveInArray<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** One entry per line, e.g. extra "distractor" words. */
export function LinesField({ label, hint, value, onChange }: { label: string; hint?: ReactNode; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="field">
      <label>
        <span className="label-text">{label}</span>
        <textarea rows={3} defaultValue={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />
      </label>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
