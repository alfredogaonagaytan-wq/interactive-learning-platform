import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { builderCards, seededDerangedShuffle, splitSentence, type SentenceBuilderItem, type SentenceBuilderResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { LinesField, moveInArray } from '../../ui/lists';
import type { ItemPlugin } from '../types';

export const sentenceBuilderPlugin: ItemPlugin<SentenceBuilderItem, SentenceBuilderResponse> = {
  type: 'sentence-builder',
  label: 'Sentence builder',
  description: 'Put words in the right order to rebuild a sentence (word order, syntax).',
  Editor({ item, onChange }) {
    const { parts, ending } = splitSentence(item.sentence);
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <TextField label="Correct sentence" value={item.sentence} onChange={(sentence) => onChange({ ...item, sentence })} placeholder="Yesterday / I / went to / the park." hint={<>Each word becomes a card. Use <kbd> / </kbd> to keep words together. Final punctuation stays fixed at the end.</>} />
        <p className="field-hint" aria-live="polite">{parts.length} cards: {parts.map((p, i) => <span key={i} className="badge">{p}</span>)}{ending && <> + “{ending}”</>}</p>
        <LinesField label="Other correct orders (whole sentences), one per line" value={item.alternatives} onChange={(alternatives) => onChange({ ...item, alternatives })} />
        <LinesField label="Extra cards (distractors), one per line" value={item.distractors} onChange={(distractors) => onChange({ ...item, distractors })} />
        <Checkbox label="Show cards in lower case (so the capital letter does not give away the first word)" checked={item.lowercaseCards} onChange={(lowercaseCards) => onChange({ ...item, lowercaseCards })} />
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[{ value: 'all-or-nothing', label: 'Whole sentence must be correct' }, { value: 'per-position', label: 'Credit for each card in the right place' }]} />
        </div>
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const { cards, ending } = useMemo(() => builderCards(item), [item]);
    const shuffled = useMemo(() => seededDerangedShuffle(cards, seed + item.id), [cards, seed, item.id]);
    const byId = new Map(cards.map((c) => [c.id, c.text]));
    const line = response.order.filter((id) => byId.has(id));
    const bank = shuffled.filter((c) => !line.includes(c.id));
    const [announce, setAnnounce] = useState('');
    const [dragId, setDragId] = useState<string | null>(null);
    const moved = useRef(false); // a drag that reordered must not also count as a click (remove)
    const lineRef = useRef<HTMLDivElement>(null);
    const parts = new Map(result?.parts.map((p) => [Number(p.partId), p]));

    const set = (order: string[], msg: string, focusIndex?: number) => {
      onChange({ order });
      setAnnounce(msg);
      if (focusIndex !== undefined) requestAnimationFrame(() => lineRef.current?.querySelectorAll<HTMLButtonElement>('.line-card')[focusIndex]?.focus());
    };
    const add = (id: string) => !disabled && set([...line, id], `${byId.get(id)} added at position ${line.length + 1}.`);
    const remove = (i: number) => !disabled && set(line.filter((_, k) => k !== i), `${byId.get(line[i]!)} removed.`);
    const onLineKey = (e: KeyboardEvent, i: number) => {
      if (disabled) return;
      if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        set(moveInArray(line, i, i - 1), `${byId.get(line[i]!)} moved to position ${i}.`, i - 1);
      } else if (e.key === 'ArrowRight' && i < line.length - 1) {
        e.preventDefault();
        set(moveInArray(line, i, i + 1), `${byId.get(line[i]!)} moved to position ${i + 2}.`, i + 1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(i);
      }
    };
    const drag = (id: string) => ({
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (disabled || !line.includes(id)) return;
        setDragId(id);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove(e: ReactPointerEvent<HTMLElement>) {
        if (dragId !== id) return;
        const over = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.('[data-line-index]')).find(Boolean) as HTMLElement | undefined;
        const to = over ? Number(over.dataset.lineIndex) : -1;
        const from = line.indexOf(id);
        if (to >= 0 && to !== from) {
          moved.current = true;
          onChange({ order: moveInArray(line, from, to) });
        }
      },
      onPointerUp() {
        setDragId(null);
      },
    });
    return (
      <div className="sentence-builder" role="group" aria-label={`${label}: ${item.prompt}`}>
        <p className="prompt">{item.prompt}</p>
        <p className="instruction">Tap words to add them in order. In your sentence: drag to reorder, or use ← → keys; Delete removes a word.</p>
        <div className="token-bank" role="group" aria-label="Word cards">
          {bank.map((c) => (
            <button key={c.id} type="button" className="token" disabled={disabled} onClick={() => add(c.id)} aria-label={`Add “${c.text}”`}>{c.text}</button>
          ))}
          {bank.length === 0 && <span className="token-bank-empty">All cards used.</span>}
        </div>
        <div ref={lineRef} className="sentence-line" role="group" aria-label="Your sentence">
          {line.length === 0 && <span className="slot-empty">Your sentence will appear here.</span>}
          {line.map((id, i) => {
            const part = parts.get(i);
            return (
              <button
                key={id}
                type="button"
                data-line-index={i}
                className={`token line-card ${dragId === id ? 'is-picked' : ''} ${result ? (part?.correct ? 'is-correct' : 'is-wrong') : ''}`}
                disabled={disabled}
                aria-label={`${byId.get(id)}, word ${i + 1} of ${line.length}. Press to remove; arrow keys move it.`}
                onClick={() => {
                  if (moved.current) {
                    moved.current = false;
                    return;
                  }
                  remove(i);
                }}
                onKeyDown={(e) => onLineKey(e, i)}
                {...drag(id)}
              >
                {byId.get(id)}
              </button>
            );
          })}
          {ending && <span className="sentence-ending">{ending}</span>}
        </div>
        {line.length > 0 && !disabled && <button type="button" className="ghost small" onClick={() => set([], 'Sentence cleared.')}>Clear</button>}
        {showKey && <p className="badge key">{item.sentence.replace(/\s*\/\s*/g, ' ')}</p>}
        <div className="sr-only" role="status" aria-live="assertive">{announce}</div>
      </div>
    );
  },
};
