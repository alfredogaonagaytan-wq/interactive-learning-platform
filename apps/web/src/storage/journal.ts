import { isSimulation } from '../sim/mode';
import { AttemptSchema, type Attempt } from '@ilp/core';

/**
 * Write-ahead journal for student work.
 *
 * IndexedDB writes are asynchronous and may not finish if the tab is closed or
 * reloaded right after a keystroke. localStorage writes are synchronous, so
 * every change is journaled here first and removed once IndexedDB confirms the
 * save. On load, a newer journal entry wins and is written back to IndexedDB.
 * Storage can be unavailable (private mode, blocked site data): every access
 * is guarded and the app keeps working without the journal.
 */
const PREFIX = isSimulation() ? 'ilp.sim.journal.' : 'ilp.journal.';
const key = (a: Pick<Attempt, 'activityId' | 'version' | 'mode'>) => `${PREFIX}${a.activityId}.${a.version}.${a.mode}`;

export function journalWrite(a: Attempt): void {
  try {
    localStorage.setItem(key(a), JSON.stringify(a));
  } catch {
    /* storage full or unavailable */
  }
}

export function journalClear(a: Attempt): void {
  try {
    const raw = localStorage.getItem(key(a));
    // Only clear if nothing newer was journaled while the save was in flight.
    if (raw && (JSON.parse(raw) as Attempt).updatedAt <= a.updatedAt) localStorage.removeItem(key(a));
  } catch {
    /* ignore */
  }
}

export function journalRead(ref: Pick<Attempt, 'activityId' | 'version' | 'mode'>): Attempt | null {
  try {
    const raw = localStorage.getItem(key(ref));
    if (!raw) return null;
    const parsed = AttemptSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function journalClearAll(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function journalClearFor(activityId: string, mode?: Attempt['mode']): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(`${PREFIX}${activityId}.`) && (mode === undefined || k.endsWith(`.${mode}`))) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
