import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ImageRef } from '@ilp/core';
import { AssetImage } from './media';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Region extends Rect {
  id: string;
  label: string;
  shape?: 'rect' | 'ellipse';
  tone?: 'ok' | 'neutral';
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Authoring canvas: drag on empty space to draw a new region, drag a region to
 * move it. Coordinates are percentages of the image, so they survive resizing.
 * The numeric fields next to the canvas are the keyboard alternative.
 */
export function RegionCanvas({ image, regions, selectedId, onSelect, onCreate, onChange, children }: {
  image: ImageRef;
  regions: Region[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (r: Rect) => void;
  onChange: (id: string, r: Rect) => void;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraftState] = useState<Rect | null>(null);
  // Pointer-up can arrive before React renders the last move, so keep the live rectangle in a ref too.
  const draftRef = useRef<Rect | null>(null);
  const setDraft = (r: Rect | null) => {
    draftRef.current = r;
    setDraftState(r);
  };
  const op = useRef<{ kind: 'draw'; x0: number; y0: number } | { kind: 'move'; id: string; dx: number; dy: number; r: Rect } | null>(null);

  const pct = (e: ReactPointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - b.left) / b.width) * 100), y: clamp(((e.clientY - b.top) / b.height) * 100) };
  };

  return (
    <div
      ref={box}
      className="region-canvas"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const p = pct(e);
        const regionEl = (e.target as HTMLElement).closest<HTMLElement>('[data-region-id]');
        const r = regionEl ? regions.find((x) => x.id === regionEl.dataset.regionId) : undefined;
        if (r) {
          onSelect(r.id);
          op.current = { kind: 'move', id: r.id, dx: p.x - r.x, dy: p.y - r.y, r };
        } else {
          op.current = { kind: 'draw', x0: p.x, y0: p.y };
          setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
        }
        box.current!.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const o = op.current;
        if (!o) return;
        const p = pct(e);
        if (o.kind === 'draw') setDraft({ x: Math.min(o.x0, p.x), y: Math.min(o.y0, p.y), w: Math.abs(p.x - o.x0), h: Math.abs(p.y - o.y0) });
        else onChange(o.id, { ...o.r, x: round(clamp(p.x - o.dx, 0, 100 - o.r.w)), y: round(clamp(p.y - o.dy, 0, 100 - o.r.h)) });
      }}
      onPointerUp={() => {
        const o = op.current;
        op.current = null;
        const d = draftRef.current;
        if (o?.kind === 'draw' && d && d.w > 2 && d.h > 2) onCreate({ x: round(d.x), y: round(d.y), w: round(d.w), h: round(d.h) });
        setDraft(null);
      }}
    >
      <AssetImage image={image} className="region-img" />
      {regions.map((r) => (
        <div
          key={r.id}
          data-region-id={r.id}
          className={`region ${r.shape === 'ellipse' ? 'ellipse' : ''} ${r.tone === 'ok' ? 'tone-ok' : ''} ${selectedId === r.id ? 'is-selected' : ''}`}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
          aria-hidden="true"
        >
          <span className="region-label">{r.label}</span>
        </div>
      ))}
      {draft && <div className="region draft" style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%` }} aria-hidden="true" />}
      {children}
    </div>
  );
}

/** Keyboard-accessible numeric position fields for a region. */
export function RectFields({ value, onChange, label }: { value: Rect; onChange: (r: Rect) => void; label: string }) {
  const f = (k: keyof Rect, name: string) => (
    <label className="rect-field">
      <span>{name}</span>
      <input type="number" min={0} max={100} step={1} aria-label={`${label} ${name} (%)`} value={value[k]} onChange={(e) => { const n = e.target.valueAsNumber; if (!Number.isNaN(n)) onChange({ ...value, [k]: clamp(n) }); }} />
    </label>
  );
  return <div className="rect-fields">{f('x', 'Left')}{f('y', 'Top')}{f('w', 'Width')}{f('h', 'Height')}</div>;
}
