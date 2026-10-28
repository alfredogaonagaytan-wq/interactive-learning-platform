import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/**
 * Shared interaction model for every "place X into Y" activity
 * (drag the words, matching, drag-and-drop zones).
 *
 * Three equivalent ways to do the same thing:
 *  1. Drag with mouse, finger or pen (pointer events + hit-testing on [data-drop-id]).
 *  2. Tap/click a card to pick it up, then tap a gap/zone to put it down.
 *  3. Keyboard: Tab to a card, Enter/Space to pick up, Tab to a target, Enter/Space
 *     to place; Escape cancels. Screen readers hear every step via a live region.
 * Native HTML5 drag-and-drop is not used: it does not work with touch on most phones.
 */
export const BANK = '__bank__';

export interface PlacementToken {
  id: string;
  label: string;
  content?: ReactNode;
}

export type TargetStatus = 'correct' | 'wrong' | undefined;

interface Options {
  tokens: PlacementToken[];
  /** tokenId -> targetId */
  placements: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** Max tokens per target; null = unlimited. */
  capacity: (targetId: string) => number | null;
  targetLabel: (targetId: string) => string;
  disabled: boolean;
}

const DRAG_THRESHOLD = 6;

export function usePlacement({ tokens, placements, onChange, capacity, targetLabel, disabled }: Options) {
  const [selected, setSelected] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const labelOf = (id: string) => byId.get(id)?.label ?? '';
  const occupants = (targetId: string) => tokens.filter((t) => placements[t.id] === targetId).map((t) => t.id);

  useEffect(() => {
    if (disabled) setSelected(null);
  }, [disabled]);

  const place = useCallback(
    (tokenId: string, targetId: string) => {
      if (disabled) return;
      const next = { ...placements };
      const from = next[tokenId];
      if (targetId === BANK) {
        delete next[tokenId];
        setAnnounce(`${labelOf(tokenId)} returned to the card bank.`);
      } else {
        if (from === targetId) {
          setSelected(null);
          return;
        }
        const others = tokens.filter((t) => t.id !== tokenId && next[t.id] === targetId).map((t) => t.id);
        const cap = capacity(targetId);
        if (cap !== null && others.length >= cap) {
          if (cap !== 1) {
            setAnnounce(`${targetLabel(targetId)} is full.`);
            return;
          }
          const other = others[0]!;
          if (from) next[other] = from;
          else delete next[other];
        }
        next[tokenId] = targetId;
        setAnnounce(`${labelOf(tokenId)} placed in ${targetLabel(targetId)}.`);
      }
      setSelected(null);
      onChange(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placements, tokens, disabled, onChange, capacity, targetLabel],
  );

  const pick = (tokenId: string) => {
    if (disabled) return;
    if (selected === tokenId) {
      setSelected(null);
      setAnnounce('Cancelled.');
    } else {
      setSelected(tokenId);
      setAnnounce(`${labelOf(tokenId)} picked up. Choose where to place it.`);
    }
  };

  const activateTarget = (targetId: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (selected) place(selected, targetId);
  };

  // ---- pointer dragging ----
  const pointerHandlers = (tokenId: string) => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag.current = { id: tokenId, startX: e.clientX, startY: e.clientY, active: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
      setGhost({ id: d.id, x: e.clientX, y: e.clientY });
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      if (!d?.active) return; // a plain click: handled by onClick
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const hit = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.('[data-drop-id]')).find(Boolean) as HTMLElement | undefined;
      if (hit?.dataset.dropId) place(d.id, hit.dataset.dropId);
    },
    onPointerCancel() {
      drag.current = null;
      setGhost(null);
    },
    onClick() {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      pick(tokenId);
    },
    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selected) {
        e.preventDefault();
        setSelected(null);
        setAnnounce('Cancelled.');
      }
    },
  });

  function tokenButton(id: string, extraClass = '', status?: TargetStatus) {
    const t = byId.get(id);
    if (!t) return null;
    return (
      <button
        key={id}
        type="button"
        className={`token ${selected === id ? 'is-picked' : ''} ${status ? `is-${status}` : ''} ${extraClass}`}
        aria-pressed={selected === id}
        aria-label={`${t.label}${placements[id] ? `, in ${targetLabel(placements[id]!)}` : ''}${status ? ` (${status === 'correct' ? 'correct' : 'incorrect'})` : ''}`}
        disabled={disabled}
        {...pointerHandlers(id)}
      >
        {t.content ?? t.label}
      </button>
    );
  }

  /** Unplaced cards. Also a drop target to send cards back. */
  function bank(opts: { label?: string; className?: string } = {}) {
    const free = tokens.filter((t) => !placements[t.id]);
    return (
      <div className={`token-bank ${selected && placements[selected] ? 'is-receiving' : ''} ${opts.className ?? ''}`} data-drop-id={BANK} role="group" aria-label={opts.label ?? 'Card bank'}>
        {free.map((t) => tokenButton(t.id))}
        {free.length === 0 && <span className="token-bank-empty">All cards placed.</span>}
        {selected && placements[selected] && !disabled && (
          <button type="button" className="ghost small" onClick={() => place(selected, BANK)}>Return “{labelOf(selected)}” to bank</button>
        )}
      </div>
    );
  }

  /** Single-card target (gap, match slot). One button: place/swap when holding a card, pick up otherwise. */
  function slot(targetId: string, opts: { className?: string; status?: TargetStatus; emptyText?: string; style?: CSSProperties } = {}) {
    const [occupant] = occupants(targetId);
    const label = targetLabel(targetId);
    const handlers = occupant ? pointerHandlers(occupant) : null;
    return (
      <button
        type="button"
        data-drop-id={targetId}
        className={`slot ${occupant ? 'is-filled' : 'is-empty'} ${selected ? 'is-receiving' : ''} ${occupant && selected === occupant ? 'is-picked' : ''} ${opts.status ? `is-${opts.status}` : ''} ${opts.className ?? ''}`}
        style={opts.style}
        disabled={disabled}
        aria-label={`${label}: ${occupant ? labelOf(occupant) : 'empty'}${opts.status ? ` (${opts.status === 'correct' ? 'correct' : 'incorrect'})` : ''}${selected && selected !== occupant ? `. Press to place ${labelOf(selected)} here` : ''}`}
        {...(handlers ? { onPointerDown: handlers.onPointerDown, onPointerMove: handlers.onPointerMove, onPointerUp: handlers.onPointerUp, onPointerCancel: handlers.onPointerCancel, onKeyDown: handlers.onKeyDown } : {})}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (selected && selected !== occupant) place(selected, targetId);
          else if (occupant) pick(occupant);
        }}
      >
        {occupant ? (byId.get(occupant)?.content ?? labelOf(occupant)) : <span className="slot-empty">{opts.emptyText ?? ' '}</span>}
      </button>
    );
  }

  /** Multi-card target (drop zone / category). */
  function zone(targetId: string, opts: { className?: string; style?: CSSProperties; showLabel?: boolean; tokenStatus?: (tokenId: string) => TargetStatus } = {}) {
    const inside = occupants(targetId);
    const label = targetLabel(targetId);
    return (
      <div key={targetId} data-drop-id={targetId} className={`zone ${selected ? 'is-receiving' : ''} ${opts.className ?? ''}`} style={opts.style} role="group" aria-label={label}>
        <button type="button" className="zone-target" disabled={disabled || !selected} onClick={() => activateTarget(targetId)} aria-label={selected ? `Place ${labelOf(selected)} in ${label}` : `${label}, ${inside.length} card${inside.length === 1 ? '' : 's'}`}>
          {opts.showLabel === false ? <span className="sr-only">{label}</span> : label}
        </button>
        <div className="zone-cards">{inside.map((id) => tokenButton(id, 'in-zone', opts.tokenStatus?.(id)))}</div>
      </div>
    );
  }

  const overlay = (
    <>
      <div className="sr-only" role="status" aria-live="assertive">{announce}</div>
      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          {byId.get(ghost.id)?.content ?? labelOf(ghost.id)}
        </div>
      )}
    </>
  );

  return { selected, bank, slot, zone, tokenButton, overlay, place };
}
