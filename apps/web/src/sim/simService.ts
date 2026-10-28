import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { GoogleEmulator, b64encode, type EmuState } from '../../../../services/submission-broker/emulator/googleEmulator';
import manifest from '../../../../services/submission-broker/src/appsscript.json';
import { createService, type SimulatedService } from '../../../../services/submission-broker/dist/service-module.js';
import { SIM_BROKER_PREFIX, SIM_CLIENT_ID, isSimulation } from './mode';

/**
 * SIMULATED submission services. Each fictional teacher gets one: the same
 * service code as the Apps Script (built from src/Code.js and the grading
 * core) running in this browser against the labelled Google EMULATOR, which
 * enforces the same drive.file rules as the tests. State is kept in its own
 * database, separate from real work.
 */
export interface SimPerson { id: string; kind: 'teacher' | 'student'; name: string; email: string; sub: string; brokerId?: string; createdAt: string }
interface SimDB extends DBSchema {
  services: { key: string; value: { brokerId: string; state: EmuState; ownerSub: string } };
  people: { key: string; value: SimPerson };
}

let dbp: Promise<IDBPDatabase<SimDB>> | null = null;
function simDb() {
  if (!isSimulation()) throw new Error('Simulation mode is off.');
  dbp ??= openDB<SimDB>('ilp-simulation-google', 1, {
    upgrade(d) {
      d.createObjectStore('services', { keyPath: 'brokerId' });
      d.createObjectStore('people', { keyPath: 'id' });
    },
  });
  return dbp;
}

const live = new Map<string, { emu: GoogleEmulator; svc: SimulatedService }>();
async function load(brokerId: string) {
  const hit = live.get(brokerId);
  if (hit) return hit;
  const row = await (await simDb()).get('services', brokerId);
  if (!row) throw new Error('This simulated service no longer exists (simulation data was reset).');
  const emu = new GoogleEmulator({ scopes: manifest.oauthScopes, state: row.state });
  const entry = { emu, svc: createService(emu.services(), { clientId: SIM_CLIENT_ID }) };
  live.set(brokerId, entry);
  return entry;
}
async function save(brokerId: string, emu: GoogleEmulator, ownerSub: string) {
  await (await simDb()).put('services', { brokerId, state: structuredClone(emu.state), ownerSub });
}

const rand = (n: number) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 56]).join('');
const b64url = (o: unknown) => b64encode(new TextEncoder().encode(JSON.stringify(o)), true).replace(/=+$/, '');

/** A simulated Google ID token: unsigned, for the invalid simulated client, registered only in this simulated service. */
export async function simToken(person: SimPerson, brokerId: string): Promise<string> {
  const { emu } = await load(brokerId);
  const info = { aud: SIM_CLIENT_ID, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, email: person.email, email_verified: 'true', sub: person.sub, nonce: `ilp-b.${brokerId}` };
  const token = `${b64url({ alg: 'none', typ: 'SIMULATED' })}.${b64url({ ...info, email_verified: true, name: person.name, simulated: true })}.SIMULATED`;
  emu.registerToken(token, info);
  return token;
}

/** One request to a simulated service, exactly as the app would POST it to Apps Script. */
export async function simCall(brokerId: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string; message?: string }> {
  const { emu, svc } = await load(brokerId);
  const out = JSON.parse(svc.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const row = await (await simDb()).get('services', brokerId);
  await save(brokerId, emu, row?.ownerSub ?? '');
  return out;
}

/** Creates a fictional teacher with their own simulated service, set up and connected (setup + Connect with the code). */
export async function createSimTeacher(name: string): Promise<SimPerson> {
  const brokerId = `${SIM_BROKER_PREFIX}${rand(24)}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'teacher';
  const person: SimPerson = { id: `sim_t_${rand(10)}`, kind: 'teacher', name, email: `${slug}.${rand(4).toLowerCase()}@teachers.example`, sub: `sim-${rand(16)}`, brokerId, createdAt: new Date().toISOString() };
  const emu = new GoogleEmulator({ scopes: manifest.oauthScopes });
  const svc = createService(emu.services(), { clientId: SIM_CLIENT_ID });
  svc.setup();
  const code = /Connection code[^:]*: ([A-Z0-9-]{19})/.exec(emu.logs.join('\n'))?.[1];
  live.set(brokerId, { emu, svc });
  await save(brokerId, emu, person.sub);
  const r = await simCall(brokerId, { action: 'whoami', idToken: await simToken(person, brokerId), connectCode: code });
  if (!r.ok) throw new Error(r.message ?? 'The simulated service could not be connected.');
  await (await simDb()).put('people', person);
  return person;
}

const FIRST = ['Ada', 'Ben', 'Chloe', 'Dev', 'Eun-ji', 'Felix', 'Gia', 'Hana', 'Ivan', 'Jun', 'Kemal', 'Lina', 'Minho', 'Nora', 'Omar', 'Priya'];
export async function addSimStudents(count: number): Promise<SimPerson[]> {
  const d = await simDb();
  const existing = (await d.getAll('people')).filter((p) => p.kind === 'student').length;
  const out: SimPerson[] = [];
  for (let i = 0; i < count; i++) {
    const n = existing + i;
    const first = FIRST[n % FIRST.length]!;
    const p: SimPerson = { id: `sim_s_${rand(10)}`, kind: 'student', name: `${first} Example${n >= FIRST.length ? ` ${Math.floor(n / FIRST.length) + 1}` : ''}`, email: `${first.toLowerCase().replace(/[^a-z]/g, '')}${n + 1}@students.example`, sub: `sim-${rand(16)}`, createdAt: new Date().toISOString() };
    await d.put('people', p);
    out.push(p);
  }
  return out;
}

export async function listSimPeople(): Promise<SimPerson[]> {
  return (await (await simDb()).getAll('people')).sort((a, b) => a.kind.localeCompare(b.kind) || a.createdAt.localeCompare(b.createdAt));
}
export async function getSimPerson(id: string): Promise<SimPerson | undefined> {
  return (await simDb()).get('people', id);
}

/** Deletes every simulated service, person and simulated file. */
export async function resetSimulationGoogle(): Promise<void> {
  live.clear();
  const d = await simDb();
  await d.clear('services');
  await d.clear('people');
}
