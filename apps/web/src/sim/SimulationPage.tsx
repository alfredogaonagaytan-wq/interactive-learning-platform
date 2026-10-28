import { useCallback, useEffect, useState } from 'react';
import { isSimulation, setSimulation } from './mode';
import { actAs, actingId } from './acting';
import { broker } from '../google/broker';
import type { SimPerson } from './simService';

/** Simulation mode: fictional teachers and students, simulated Google services, separate data. */
export function SimulationPage() {
  if (!isSimulation()) return <SimulationIntro />;
  return <SimulationWorkspace />;
}

function SimulationIntro() {
  return (
    <section className="narrow" aria-labelledby="sim-h">
      <h1 id="sim-h">Simulation mode</h1>
      <p>Try the whole platform without a Google account: create fictional teachers and students, build and assign activities, submit as a student, and see the teacher’s results — grading, reports, grammar, listening, dictation and speaking work as they do for real.</p>
      <ul>
        <li>Each fictional teacher gets a <strong>simulated submission service</strong> that runs the same service code in this browser, against simulated Google Drive and Sheets.</li>
        <li>Everything is stored in <strong>separate</strong> browser databases. Your real activities and student work are not visible or changed.</li>
        <li>Nothing is sent to Google. Simulated receipts and reports are labelled <strong>SIMULATED</strong> and are never accepted by a real submission service.</li>
        <li>Microphone recording uses your real microphone; recordings stay on this device.</li>
      </ul>
      <button type="button" className="primary" onClick={() => setSimulation(true)}>Start Simulation mode</button>
    </section>
  );
}

function SimulationWorkspace() {
  const [people, setPeople] = useState<SimPerson[]>([]);
  const [acting, setActing] = useState<string | null>(actingId());
  const [name, setName] = useState('Ms Example');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const { listSimPeople } = await import('./simService');
    setPeople(await listSimPeople());
    setActing(actingId());
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg({ kind: 'info', text: `${what}…` });
    try {
      const text = await fn();
      setMsg({ kind: 'ok', text: text || `${what}: done.` });
      await refresh();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const teachers = people.filter((p) => p.kind === 'teacher');
  const students = people.filter((p) => p.kind === 'student');
  const me = people.find((p) => p.id === acting) ?? null;

  const sampleClass = () => run('Creating a sample class', async () => {
    if (!me || me.kind !== 'teacher' || !me.brokerId) throw new Error('Act as a fictional teacher first.');
    if (students.length === 0) throw new Error('Add fictional students first.');
    const cls = await broker.createClass(me.brokerId, 'Sample class', 'Simulation');
    await broker.putRoster(me.brokerId, cls.classId, students.map((s, i) => ({ studentNumber: `S${String(i + 1).padStart(2, '0')}`, name: s.name, email: s.email, status: 'active' as const })));
    return `Created “Sample class” with ${students.length} fictional students. Next: Teacher → open or create an activity → Publish → Assign, then act as a student and open the assignment link from Classes.`;
  });

  return (
    <section aria-labelledby="sim-h">
      <div className="page-head"><h1 id="sim-h">Simulation</h1></div>
      <p>You are {me ? <>acting as <strong>{me.name}</strong> ({me.kind === 'teacher' ? 'fictional teacher' : 'fictional student'}, {me.email})</> : <strong>not acting as anyone yet</strong>}. Switch at any time, here or in the banner above.</p>
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
      <div className="sim-grid">
        <div className="card">
          <h2>Fictional teachers</h2>
          <ul className="sim-people">
            {teachers.map((p) => <PersonRow key={p.id} p={p} acting={acting === p.id} onAct={() => run(`Acting as ${p.name}`, async () => { await actAs(p); })} />)}
            {teachers.length === 0 && <li className="meta">None yet.</li>}
          </ul>
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void run('Creating a fictional teacher and their simulated service', async () => { const { createSimTeacher } = await import('./simService'); const t = await createSimTeacher(name.trim() || 'Ms Example'); await actAs(t); return `Created ${t.name} with a simulated submission service (set up and connected). You are now acting as ${t.name}.`; }); }}>
            <label className="field inline"><span className="label-text">Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button type="submit" className="secondary" disabled={busy}>Create fictional teacher</button>
          </form>
        </div>
        <div className="card">
          <h2>Fictional students</h2>
          <ul className="sim-people">
            {students.map((p) => <PersonRow key={p.id} p={p} acting={acting === p.id} onAct={() => run(`Acting as ${p.name}`, async () => { await actAs(p); })} />)}
            {students.length === 0 && <li className="meta">None yet.</li>}
          </ul>
          <button type="button" className="secondary" disabled={busy} onClick={() => run('Adding fictional students', async () => { const { addSimStudents } = await import('./simService'); await addSimStudents(5); })}>Add 5 fictional students</button>
        </div>
        <div className="card">
          <h2>Quick start</h2>
          <p>As a fictional teacher, create a class whose roster is every fictional student.</p>
          <button type="button" className="secondary" disabled={busy || me?.kind !== 'teacher'} onClick={sampleClass}>Create a sample class</button>
          <p className="field-hint">Then use the app as usual: Teacher (build, publish, assign), Classes (links, submissions), Student (complete).</p>
        </div>
        <div className="card">
          <h2>Leave or reset</h2>
          <div className="row wrap">
            <button type="button" className="secondary" onClick={() => setSimulation(false)}>Leave Simulation mode</button>
            <button type="button" className="ghost danger" disabled={busy} onClick={() => run('Deleting all simulation data', async () => {
              const { resetSimulationGoogle } = await import('./simService');
              await resetSimulationGoogle();
              await actAs(null);
              indexedDB.deleteDatabase('ilp-simulation');
              try { for (const k of Object.keys(localStorage)) if (k.startsWith('ilp.sim.')) localStorage.removeItem(k); } catch { /* ignore */ }
              setSimulation(true);
            })}>Delete all simulation data</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonRow({ p, acting, onAct }: { p: SimPerson; acting: boolean; onAct: () => void }) {
  return (
    <li>
      <span>{p.name} <span className="meta">{p.email}</span></span>
      {acting ? <span className="badge">Acting as</span> : <button type="button" className="ghost" onClick={onAct}>Act as {p.name}</button>}
    </li>
  );
}

/** Always visible in Simulation mode, on every page. */
export function SimulationBanner() {
  const [people, setPeople] = useState<SimPerson[]>([]);
  const [acting, setActing] = useState<string | null>(actingId());
  useEffect(() => {
    void import('./simService').then(({ listSimPeople }) => listSimPeople()).then(setPeople);
    const onHash = () => void import('./simService').then(({ listSimPeople }) => listSimPeople()).then(setPeople);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <div className="sim-banner" role="region" aria-label="Simulation mode">
      <strong>SIMULATION</strong> — fictional people and simulated Google services. Nothing here is a real submission.
      <label className="sim-act">
        Acting as{' '}
        <select value={acting ?? ''} onChange={async (e) => { const p = people.find((x) => x.id === e.target.value) ?? null; await actAs(p); setActing(p?.id ?? null); }}>
          <option value="">Nobody</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind === 'teacher' ? 'teacher' : 'student'})</option>)}
        </select>
      </label>
      <a href="#/simulation">Simulation page</a>
    </div>
  );
}
