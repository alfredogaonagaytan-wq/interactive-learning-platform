import { useMemo, useState } from 'react';
import { randomId, seededShuffle, type DragDropItem, type DragDropResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { RowControls, moveInArray } from '../../ui/lists';
import { AssetImage, ImageField } from '../../ui/media';
import { usePlacement } from '../../ui/placement';
import { RectFields, RegionCanvas } from '../../ui/regions';
import type { ItemPlugin } from '../types';

type Zone = DragDropItem['zones'][number];
type Drag = DragDropItem['draggables'][number];

export const dragDropPlugin: ItemPlugin<DragDropItem, DragDropResponse> = {
  type: 'drag-drop',
  label: 'Drag and drop',
  description: 'Sort cards into categories, or label parts of an image.',
  Editor({ item, onChange }) {
    const [sel, setSel] = useState<string | null>(item.zones[0]?.id ?? null);
    const setZone = (id: string, patch: Partial<Zone>) => onChange({ ...item, zones: item.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) });
    const setDrag = (i: number, patch: Partial<Drag>) => onChange({ ...item, draggables: item.draggables.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
    const addZone = (rect = { x: 5, y: 5, w: 25, h: 15 }) => {
      const z: Zone = { id: randomId('zon'), label: `Zone ${item.zones.length + 1}`, showLabel: true, capacity: null, ...rect };
      onChange({ ...item, zones: [...item.zones, z] });
      setSel(z.id);
    };
    return (
      <>
        <TextField label="Instructions" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <ImageField label="Background image (optional — for labelling a diagram)" value={item.background} onChange={(background) => onChange({ ...item, background })} />
        {item.background && (
          <>
            <p className="field-hint">Drag on the image to draw a drop zone; drag a zone to move it. Exact positions can be typed below.</p>
            <RegionCanvas image={item.background} regions={item.zones.map((z) => ({ ...z }))} selectedId={sel} onSelect={setSel} onCreate={(r) => addZone(r)} onChange={(id, r) => setZone(id, r)} />
          </>
        )}
        <fieldset>
          <legend>Drop zones {item.background ? '' : '(shown as boxes)'}</legend>
          {item.zones.map((z, i) => (
            <div key={z.id} className={`zone-row ${sel === z.id ? 'is-selected' : ''}`} onFocus={() => setSel(z.id)}>
              <input type="text" aria-label={`Zone ${i + 1} label`} value={z.label} onChange={(e) => setZone(z.id, { label: e.target.value })} />
              <RowControls index={i} count={item.zones.length} label={`zone ${i + 1}`} minCount={1} onMove={(a, b) => onChange({ ...item, zones: moveInArray(item.zones, a, b) })} onRemove={() => onChange({ ...item, zones: item.zones.filter((x) => x.id !== z.id), draggables: item.draggables.map((d) => ({ ...d, correctZoneIds: d.correctZoneIds.filter((id) => id !== z.id) })) })} />
              <div className="zone-options">
                <Checkbox label="Show label to students" checked={z.showLabel} onChange={(showLabel) => setZone(z.id, { showLabel })} />
                <NumberField label="Max cards" value={z.capacity} min={1} max={50} nullable onChange={(capacity) => setZone(z.id, { capacity })} />
                {item.background && <RectFields label={`Zone ${i + 1}`} value={z} onChange={(r) => setZone(z.id, r)} />}
              </div>
            </div>
          ))}
          <button type="button" className="secondary" disabled={item.zones.length >= 40} onClick={() => addZone()}>+ Add zone</button>
        </fieldset>
        <fieldset>
          <legend>Cards to drag</legend>
          {item.draggables.map((d, i) => (
            <div key={d.id} className="drag-row">
              <input type="text" aria-label={`Card ${i + 1} text`} placeholder="Card text" value={d.text} onChange={(e) => setDrag(i, { text: e.target.value })} />
              <RowControls index={i} count={item.draggables.length} label={`card ${i + 1}`} minCount={1} onMove={(a, b) => onChange({ ...item, draggables: moveInArray(item.draggables, a, b) })} onRemove={() => onChange({ ...item, draggables: item.draggables.filter((_, k) => k !== i) })} />
              <div className="zone-checks" role="group" aria-label={`Correct zones for card ${i + 1}`}>
                <span className="field-hint">Correct zone(s):</span>
                {item.zones.map((z) => (
                  <label key={z.id} className="check">
                    <input type="checkbox" checked={d.correctZoneIds.includes(z.id)} onChange={(e) => setDrag(i, { correctZoneIds: e.target.checked ? [...d.correctZoneIds, z.id] : d.correctZoneIds.filter((x) => x !== z.id) })} /> {z.label || 'unnamed'}
                  </label>
                ))}
                {d.correctZoneIds.length === 0 && <span className="badge warn">Distractor</span>}
              </div>
              <details className="pair-image" open={!!d.image}>
                <summary>{d.image ? 'Image' : 'Use an image'}</summary>
                <ImageField label={`Card ${i + 1} image`} value={d.image} onChange={(image) => setDrag(i, { image })} />
              </details>
            </div>
          ))}
          <button type="button" className="secondary" disabled={item.draggables.length >= 60} onClick={() => onChange({ ...item, draggables: [...item.draggables, { id: randomId('drg'), text: '', image: null, correctZoneIds: [] }] })}>+ Add card</button>
        </fieldset>
        <div className="grid-2">
          <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
          <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[{ value: 'per-item', label: 'Credit per card (wrong cards subtract)' }, { value: 'all-or-nothing', label: 'Everything must be correct' }]} />
        </div>
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const tokens = useMemo(
      () => seededShuffle(item.draggables, seed + item.id).map((d) => ({ id: d.id, label: d.text || d.image?.alt || 'image', content: d.image ? <span className="token-media"><AssetImage image={d.image} className="token-img" />{d.text && <span>{d.text}</span>}</span> : undefined })),
      [item, seed],
    );
    const zoneById = new Map(item.zones.map((z) => [z.id, z]));
    const parts = new Map(result?.parts.map((p) => [p.partId, p]));
    const p = usePlacement({
      tokens,
      placements: response.placements,
      onChange: (placements) => onChange({ placements }),
      capacity: (id) => zoneById.get(id)?.capacity ?? null,
      targetLabel: (id) => zoneById.get(id)?.label ?? 'zone',
      disabled,
    });
    const tokenStatus = (id: string) => {
      const part = parts.get(id);
      return part && response.placements[id] ? (part.correct ? 'correct' : 'wrong') : undefined;
    };
    return (
      <div className="drag-drop" role="group" aria-label={`${label}: ${item.prompt || 'Drag and drop'}`}>
        {item.prompt && <p className="prompt">{item.prompt}</p>}
        <p className="instruction">Drag each card to a zone, or tap a card and then tap a zone.</p>
        {p.bank({ label: 'Cards' })}
        {item.background ? (
          <div className="dd-stage">
            <AssetImage image={item.background} className="dd-bg" />
            {item.zones.map((z) => p.zone(z.id, { className: 'dd-zone-abs', showLabel: z.showLabel, style: { left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, minHeight: `${z.h}%` }, tokenStatus }))}
          </div>
        ) : (
          <div className="dd-grid">{item.zones.map((z) => p.zone(z.id, { showLabel: z.showLabel, tokenStatus }))}</div>
        )}
        {showKey && (
          <ul className="key-list">
            {item.draggables.map((d) => <li key={d.id}><span className="badge key">{d.text || d.image?.alt}</span> → {d.correctZoneIds.map((z) => zoneById.get(z)?.label).join(' or ') || 'distractor (leave in bank)'}</li>)}
          </ul>
        )}
        {p.overlay}
      </div>
    );
  },
};
