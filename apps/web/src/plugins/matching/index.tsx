import { useMemo } from 'react';
import { matchingCards, randomId, seededShuffle, type MatchingItem, type MatchingResponse } from '@ilp/core';
import { FeedbackFields, NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { LinesField, RowControls, moveInArray } from '../../ui/lists';
import { AssetImage, ImageField } from '../../ui/media';
import { usePlacement } from '../../ui/placement';
import type { ItemPlugin } from '../types';

const invert = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

export const matchingPlugin: ItemPlugin<MatchingItem, MatchingResponse> = {
  type: 'matching',
  label: 'Matching',
  description: 'Match words, images and definitions.',
  Editor({ item, onChange }) {
    const setPair = (i: number, patch: Partial<MatchingItem['pairs'][number]>) => onChange({ ...item, pairs: item.pairs.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <fieldset>
          <legend>Pairs (left prompt → right match)</legend>
          {item.pairs.map((p, i) => (
            <div key={p.id} className="pair-row">
              <span className="pair-num" aria-hidden="true">{i + 1}</span>
              <input type="text" aria-label={`Pair ${i + 1} left`} placeholder="Word or prompt" value={p.left} onChange={(e) => setPair(i, { left: e.target.value })} />
              <span aria-hidden="true">→</span>
              <input type="text" aria-label={`Pair ${i + 1} right`} placeholder="Match" value={p.right} onChange={(e) => setPair(i, { right: e.target.value })} />
              <RowControls index={i} count={item.pairs.length} label={`pair ${i + 1}`} minCount={2} onMove={(a, b) => onChange({ ...item, pairs: moveInArray(item.pairs, a, b) })} onRemove={() => onChange({ ...item, pairs: item.pairs.filter((_, k) => k !== i) })} />
              <details className="pair-image" open={!!p.leftImage}>
                <summary>{p.leftImage ? 'Image' : 'Add image to left side'}</summary>
                <ImageField label={`Pair ${i + 1} image`} value={p.leftImage} onChange={(leftImage) => setPair(i, { leftImage })} />
              </details>
            </div>
          ))}
          <button type="button" className="secondary" disabled={item.pairs.length >= 30} onClick={() => onChange({ ...item, pairs: [...item.pairs, { id: randomId('par'), left: '', leftImage: null, right: '' }] })}>+ Add pair</button>
        </fieldset>
        <LinesField label="Extra right-side cards (distractors), one per line" value={item.distractors} onChange={(distractors) => onChange({ ...item, distractors })} />
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[{ value: 'per-pair', label: 'Share points between pairs' }, { value: 'all-or-nothing', label: 'All pairs must be correct' }]} />
        </div>
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const cards = useMemo(() => seededShuffle(matchingCards(item), seed + item.id).map((c) => ({ id: c.id, label: c.text })), [item, seed]);
    const parts = new Map(result?.parts.map((p) => [p.partId, p]));
    const leftName = (p: MatchingItem['pairs'][number]) => p.left || p.leftImage?.alt || 'image';
    const p = usePlacement({
      tokens: cards,
      placements: invert(response.matches),
      onChange: (next) => onChange({ matches: invert(next) }),
      capacity: () => 1,
      targetLabel: (id) => `Match for “${leftName(item.pairs.find((x) => x.id === id)!)}”`,
      disabled,
    });
    return (
      <div className="matching" role="group" aria-label={`${label}: ${item.prompt || 'Matching'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="instruction">Drag a card next to its partner, or tap a card and then tap a box.</p>
        {p.bank({ label: 'Cards to match' })}
        <ul className="match-rows">
          {item.pairs.map((pair) => {
            const part = parts.get(pair.id);
            return (
              <li key={pair.id} className="match-row">
                <div className="match-left">
                  {pair.leftImage && <AssetImage image={pair.leftImage} className="match-img" />}
                  {pair.left && <span>{pair.left}</span>}
                </div>
                <div className="match-right">
                  {p.slot(pair.id, { status: part ? (part.correct ? 'correct' : 'wrong') : undefined, emptyText: 'Drop here' })}
                  {showKey && <span className="badge key">{pair.right}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        {p.overlay}
      </div>
    );
  },
};
