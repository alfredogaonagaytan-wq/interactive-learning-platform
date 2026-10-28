import { setDefaultService, setSimulatedIdentity } from '../google/gis';
import { setBrokerId } from '../google/brokerSetting';
import { isSimulation } from './mode';
import type { SimPerson } from './simService';

/** Which fictional person this browser is acting as (a per-device convenience). */
const ACT = 'ilp.sim.actingAs';

export function actingId(): string | null {
  try {
    return localStorage.getItem(ACT);
  } catch {
    return null;
  }
}

async function apply(p: SimPerson | null): Promise<void> {
  if (!p) {
    setSimulatedIdentity(null);
    return;
  }
  const { simToken } = await import('./simService');
  setSimulatedIdentity({ profile: { sub: p.sub, email: p.email, name: p.name, hd: '' }, simulated: true, mint: (brokerId: string) => simToken(p, brokerId) });
  // A fictional teacher uses their own simulated service; a student has none.
  await setBrokerId(p.kind === 'teacher' ? (p.brokerId ?? null) : null);
  setDefaultService(p.kind === 'teacher' ? (p.brokerId ?? null) : null);
}

export async function actAs(p: SimPerson | null): Promise<void> {
  try {
    if (p) localStorage.setItem(ACT, p.id);
    else localStorage.removeItem(ACT);
  } catch {
    /* acting identity then lasts until reload */
  }
  await apply(p);
}

/** At startup in Simulation mode: act as the person chosen last time. */
export async function restoreSimIdentity(): Promise<void> {
  if (!isSimulation()) return;
  const id = actingId();
  const { getSimPerson } = await import('./simService');
  await apply(id ? ((await getSimPerson(id)) ?? null) : null);
}
