import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { randomId, seededDerangedShuffle, type SequencingItem, type SequencingResponse } from '@ilp/core';
import { FeedbackFields, NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { RowControls, moveInArray } from '../../ui/lists';
import { AssetImage, ImageField } from '../../ui/media';
import type { ItemPlugin } from '../types';

export const sequencingPlugin: ItemPlugin<SequencingItem, SequencingResponse> = {
  type: 'sequencing',
  label: 'Sequencing',
  description: 'Put steps, events or paragraphs in the right order.',
  Editor({ item, onChange }) {
    const setStep = (i: number, patch: Partial<SequencingItem['steps'][number]>) => onChange({ ...item, steps: item.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <Select label="Display" value={item.display} onChange={(display) => onChange({ ...item, display })} options={[{ value: 'list', label: 'Short cards (steps, events, words)' }, { value: 'paragraph', label: 'Paragraphs (sort the paragraphs)' }]} />
        <fieldset>
          <legend>Steps in the correct order</legend>
          {item.steps.map((s, i) => (
            <div key={s.id} className="step-row">
              <span className="pair-num" aria-hidden="true">{i + 1}</span>
              {item.display === 'paragraph' ? (
                <textarea aria-label={`Step ${i + 1}`} rows={3} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
              ) : (
                <input type="text" aria-label={`Step ${i + 1}`} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
              )}
              <RowControls index={i} count={item.steps.length} label={`step ${i + 1}`} minCount={2} onMove={(a, b) => onChange({ ...item, steps: moveInArray(item.steps, a, b) })} onRemove={() => onChange({ ...item, steps: item.steps.filter((_, k) => k !== i) })} />
              <details className="pair-image" open={!!s.image}>
                <summary>{s.image ? 'Image' : 'Add image'}</summary>
                <ImageField label={`Step ${i + 1} image`} value={s.image} onChange={(image) => setStep(i, { image })} />
              </details>
            </div>
          ))}
          <button type="button" className="secondary" disabled={item.steps.length >= 30} onClick={() => onChange({ ...item, steps: [...item.steps, { id: randomId('seq'), text: '', image: null }] })}>+ Add step</button>
        </fieldset>
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[{ value: 'per-position', label: 'Credit for each step in the right place' }, { value: 'all-or-nothing', label: 'Whole order must be correct' }]} />
        </div>
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const initial = useMemo(() => seededDerangedShuffle(item.steps.map((s) => s.id), seed + item.id), [item, seed]);
    const order = response.order.length === item.steps.length ? response.order : initial;
    const byId = new Map(item.steps.map((s) => [s.id, s]));
    const correctIndex = new Map(item.steps.map((s, i) => [s.id, i]));
    const parts = new Map(result?.parts.map((p) => [p.partId, p]));
    const [announce, setAnnounce] = useState('');
    const [dragging, setDragging] = useState<string | null>(null);
    const listRef = useRef<HTMLOListElement>(null);
    const name = (id: string) => byId.get(id)?.text.slice(0, 60) || byId.get(id)?.image?.alt || 'item';

    const move = (from: number, to: number, focus = true) => {
      if (disabled || to < 0 || to >= order.length || from === to) return;
      const next = moveInArray(order, from, to);
      onChange({ order: next });
      setAnnounce(`${name(order[from]!)} moved to position ${to + 1} of ${order.length}.`);
      if (focus) {
        requestAnimationFrame(() => {
          const pick = (dir: string) => listRef.current?.querySelector<HTMLButtonElement>(`[data-seq-btn="${to}-${dir}"]`);
          const preferred = pick(to > from ? 'down' : 'up');
          (preferred && !preferred.disabled ? preferred : pick(to > from ? 'up' : 'down'))?.focus();
        });
      }
    };

    const dragHandlers = (id: string) => ({
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (disabled) return;
        setDragging(id);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove(e: ReactPointerEvent<HTMLElement>) {
        if (dragging !== id) return;
        const over = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.('[data-seq-index]')).find(Boolean) as HTMLElement | undefined;
        const to = over ? Number(over.dataset.seqIndex) : -1;
        const from = order.indexOf(id);
        if (to >= 0 && to !== from) move(from, to, false);
      },
      onPointerUp() {
        setDragging(null);
      },
      onPointerCancel() {
        setDragging(null);
      },
    });

    return (
      <div className={`sequencing seq-${item.display}`} role="group" aria-label={`${label}: ${item.prompt || 'Put in order'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="instruction">Drag the handle, or use the arrow buttons, to change the order.</p>
        <ol className="seq-list" ref={listRef}>
          {order.map((id, i) => {
            const s = byId.get(id)!;
            const part = parts.get(id);
            const status = part ? (part.correct ? 'is-correct' : 'is-wrong') : '';
            return (
              <li key={id} data-seq-index={i} className={`seq-card ${status} ${dragging === id ? 'is-dragging' : ''}`}>
                <span className="seq-handle" aria-hidden="true" {...dragHandlers(id)}>⋮⋮</span>
                <span className="seq-pos" aria-hidden="true">{i + 1}</span>
                <div className="seq-content">
                  {s.image && <AssetImage image={s.image} className="seq-img" />}
                  {s.text && <span className="preserve-lines">{s.text}</span>}
                  {part && <span className="sr-only">{part.correct ? ' (in the right place)' : ' (not in the right place)'}</span>}
                  {showKey && <span className="badge key">Correct position {correctIndex.get(id)! + 1}</span>}
                </div>
                <div className="icon-buttons">
                  <button type="button" className="icon" data-seq-btn={`${i}-up`} aria-label={`Move “${name(id)}” up (now ${i + 1} of ${order.length})`} disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>↑</button>
                  <button type="button" className="icon" data-seq-btn={`${i}-down`} aria-label={`Move “${name(id)}” down (now ${i + 1} of ${order.length})`} disabled={disabled || i === order.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="sr-only" role="status" aria-live="assertive">{announce}</div>
      </div>
    );
  },
};
