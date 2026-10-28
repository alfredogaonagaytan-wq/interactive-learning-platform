import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { chosenHotspot, randomId, seededShuffle, type HotspotItem, type HotspotResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextArea } from '../../ui/fields';
import { AssetImage, ImageField } from '../../ui/media';
import { RectFields, RegionCanvas } from '../../ui/regions';
import type { ItemPlugin } from '../types';

type Spot = HotspotItem['hotspots'][number];

export const hotspotPlugin: ItemPlugin<HotspotItem, HotspotResponse> = {
  type: 'hotspot',
  label: 'Find the hotspot',
  description: 'Students click the correct part of an image.',
  Editor({ item, onChange }) {
    const [sel, setSel] = useState<string | null>(item.hotspots[0]?.id ?? null);
    const setSpot = (id: string, patch: Partial<Spot>) => onChange({ ...item, hotspots: item.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
    return (
      <>
        <TextArea label="Question" value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} placeholder="Click the nucleus." />
        <ImageField label="Image" value={item.image} allowDecorative={false} onChange={(image) => onChange({ ...item, image })} />
        {item.image && (
          <>
            <p className="field-hint">Drag on the image to draw a hotspot; drag a hotspot to move it.</p>
            <RegionCanvas
              image={item.image}
              regions={item.hotspots.map((h) => ({ ...h, tone: h.correct ? 'ok' : 'neutral' }))}
              selectedId={sel}
              onSelect={setSel}
              onCreate={(r) => {
                const h: Spot = { id: randomId('hsp'), label: `Area ${item.hotspots.length + 1}`, shape: 'rect', correct: item.hotspots.length === 0, ...r };
                onChange({ ...item, hotspots: [...item.hotspots, h] });
                setSel(h.id);
              }}
              onChange={(id, r) => setSpot(id, r)}
            />
          </>
        )}
        <fieldset>
          <legend>Hotspots</legend>
          {item.hotspots.length === 0 && <p className="field-hint">{item.image ? 'Draw an area on the image, or add one here.' : 'Choose an image first.'}</p>}
          {item.hotspots.map((h, i) => (
            <div key={h.id} className={`zone-row ${sel === h.id ? 'is-selected' : ''}`} onFocus={() => setSel(h.id)}>
              <input type="text" aria-label={`Hotspot ${i + 1} label`} value={h.label} onChange={(e) => setSpot(h.id, { label: e.target.value })} />
              <button type="button" className="icon danger" aria-label={`Remove hotspot ${i + 1}`} onClick={() => onChange({ ...item, hotspots: item.hotspots.filter((x) => x.id !== h.id) })}>×</button>
              <div className="zone-options">
                <Checkbox label="Correct answer" checked={h.correct} onChange={(correct) => setSpot(h.id, { correct })} />
                <Select label="Shape" value={h.shape} onChange={(shape) => setSpot(h.id, { shape })} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }]} />
                <RectFields label={`Hotspot ${i + 1}`} value={h} onChange={(r) => setSpot(h.id, r)} />
                <input type="text" aria-label={`Hotspot ${i + 1} feedback`} placeholder="Feedback when clicked (optional)" value={h.feedback ?? ''} onChange={(e) => setSpot(h.id, { feedback: e.target.value || undefined })} />
              </div>
            </div>
          ))}
          <button type="button" className="secondary" disabled={!item.image} onClick={() => onChange({ ...item, hotspots: [...item.hotspots, { id: randomId('hsp'), label: `Area ${item.hotspots.length + 1}`, shape: 'rect', x: 40, y: 40, w: 20, h: 20, correct: item.hotspots.length === 0 }] })}>+ Add hotspot</button>
        </fieldset>
        <Checkbox label="Offer “choose from a list” for screen-reader users" hint="Lists the hotspot labels as options. Turn off if the labels would give the answer away (keyboard crosshair input is always available)." checked={item.allowListAlternative} onChange={(allowListAlternative) => onChange({ ...item, allowListAlternative })} />
        <NumberField label="Points" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, result, showKey, seed, label }) {
    const box = useRef<HTMLDivElement>(null);
    const helpId = useId();
    const listName = useId();
    const [cursor, setCursor] = useState<{ x: number; y: number }>(response.point ?? { x: 50, y: 50 });
    const [focused, setFocused] = useState(false);
    const listOptions = useMemo(() => seededShuffle(item.hotspots, seed + item.id), [item, seed]);
    const chosen = chosenHotspot(item, response);
    if (!item.image) return <p className="notice error">This question has no image.</p>;

    const choose = (x: number, y: number) => {
      if (disabled) return;
      const point = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      setCursor(point);
      onChange({ point, hotspotId: null });
    };
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 1 : 5;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        setCursor((c) => ({ x: Math.min(100, Math.max(0, c.x + m[0])), y: Math.min(100, Math.max(0, c.y + m[1])) }));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(cursor.x, cursor.y);
      }
    };
    const status = result ? (result.status === 'correct' ? 'is-correct' : 'is-wrong') : '';
    return (
      <div className="hotspot" role="group" aria-label={`${label}: ${item.prompt}`}>
        <p className="prompt preserve-lines">{item.prompt}</p>
        <p id={helpId} className="instruction">Click or tap the image. With a keyboard: use the arrow keys to move the crosshair (Shift for small steps) and press Enter to choose.</p>
        <div
          ref={box}
          className={`hotspot-stage ${disabled ? 'is-disabled' : ''}`}
          tabIndex={disabled ? -1 : 0}
          role="button"
          aria-label={`${item.image.alt || 'Image'}. Crosshair at ${Math.round(cursor.x)}% across, ${Math.round(cursor.y)}% down.${response.point ? ' A point is selected.' : ''}`}
          aria-describedby={helpId}
          aria-disabled={disabled}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={(e) => {
            const b = box.current!.getBoundingClientRect();
            choose(((e.clientX - b.left) / b.width) * 100, ((e.clientY - b.top) / b.height) * 100);
          }}
        >
          <AssetImage image={{ ...item.image, decorative: true }} className="hotspot-img" />
          {showKey && item.hotspots.map((h) => (
            <div key={h.id} className={`region ${h.shape === 'ellipse' ? 'ellipse' : ''} ${h.correct ? 'tone-ok' : ''}`} style={{ left: `${h.x}%`, top: `${h.y}%`, width: `${h.w}%`, height: `${h.h}%` }} aria-hidden="true"><span className="region-label">{h.label}</span></div>
          ))}
          {focused && !disabled && <span className="crosshair" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }} aria-hidden="true" />}
          {response.point && <span className={`hotspot-marker ${status}`} style={{ left: `${response.point.x}%`, top: `${response.point.y}%` }} aria-hidden="true" />}
        </div>
        {response.point && <p className="meta" role="status">You chose: {chosen && (result || showKey) ? chosen.label : 'a point on the image'}.</p>}
        {item.allowListAlternative && (
          <details className="list-alt" open={!!response.hotspotId}>
            <summary>Choose from a list instead</summary>
            <fieldset className="mc">
              <legend className="sr-only">Areas of the image</legend>
              {listOptions.map((h) => (
                <label key={h.id} className={`choice ${response.hotspotId === h.id ? 'is-selected' : ''}`}>
                  <input type="radio" name={listName} disabled={disabled} checked={response.hotspotId === h.id} onChange={() => onChange({ point: null, hotspotId: h.id })} />
                  <span className="choice-text">{h.label}</span>
                </label>
              ))}
            </fieldset>
          </details>
        )}
      </div>
    );
  },
};
