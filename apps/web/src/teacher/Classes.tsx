import { isSimulation } from '../sim/mode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { assignmentLink, parseRosterCsv, type RosterRow } from '@ilp/core';
import { broker, type AssignmentInfo, type ClassInfo, type SubmissionRow } from '../google/broker';
import { getBrokerId } from '../google/brokerSetting';
import { AccountPanel } from '../google/SignIn';
import { useAuth } from '../google/useAuth';
import { formatTime } from '../app/util';

export const appUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}`;

type EditRow = Pick<RosterRow, 'studentNumber' | 'name' | 'email' | 'status'> & { bound?: boolean };

export function Classes() {
  const { profile } = useAuth();
  const [brokerId, setBroker] = useState<string | null | undefined>(undefined);
  const [classes, setClasses] = useState<ClassInfo[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [name, setName] = useState('');
  const [section, setSection] = useState('');

  useEffect(() => void getBrokerId().then((id) => setBroker(id ?? null)), []);
  const load = useCallback(async () => {
    if (!brokerId || !profile) return;
    try {
      const c = await broker.listClasses(brokerId);
      setClasses(c);
      setSel((s) => s ?? c[0]?.classId ?? null);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, [brokerId, profile]);
  useEffect(() => void load(), [load]);

  if (brokerId === undefined) return <p role="status">Loading…</p>;
  if (!profile) return <section className="narrow"><h1>Classes</h1><AccountPanel purpose="Sign in to manage your classes, rosters and assignments." /></section>;
  if (!brokerId)
    return (
      <section className="narrow">
        <h1>Classes</h1>
        <p>Set up your submission service first. It keeps your rosters and student work in your own Google Drive.</p>
        <a className="button primary" href="#/setup-service">Set up the submission service</a>
      </section>
    );
  return (
    <section aria-labelledby="cls-h">
      <div className="page-head"><h1 id="cls-h">Classes</h1></div>
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
      <div className="classes-grid">
        <nav className="card" aria-label="Your classes">
          {classes === null ? <p role="status">Loading classes…</p> : (
            <ul className="class-list">
              {classes.map((c) => (
                <li key={c.classId}><button type="button" className={`outline-item ${sel === c.classId ? 'active' : ''}`} aria-current={sel === c.classId} onClick={() => setSel(c.classId)}>{c.name}{c.section ? ` · ${c.section}` : ''}</button></li>
              ))}
              {classes.length === 0 && <li className="meta">No classes yet.</li>}
            </ul>
          )}
          <form className="add-class" onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              const c = await broker.createClass(brokerId, name.trim(), section.trim());
              setName('');
              setSection('');
              setSel(c.classId);
              await load();
              setMsg({ kind: 'ok', text: `Created ${c.name}. Its folders are in your Google Drive under Interactive Learning Platform › Classes.` });
            } catch (err) {
              setMsg({ kind: 'error', text: (err as Error).message });
            }
          }}>
            <label htmlFor="new-class">New class</label>
            <input id="new-class" type="text" placeholder="Grade 7 Science" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="text" aria-label="Section (optional)" placeholder="Section (optional)" value={section} onChange={(e) => setSection(e.target.value)} />
            <button type="submit" className="secondary">Create class</button>
          </form>
        </nav>
        {sel && <ClassDetail key={sel} brokerId={brokerId} classId={sel} cls={classes?.find((c) => c.classId === sel)} onMessage={setMsg} />}
      </div>
    </section>
  );
}

function ClassDetail({ brokerId, classId, cls, onMessage }: { brokerId: string; classId: string; cls?: ClassInfo; onMessage: (m: { kind: 'ok' | 'error'; text: string }) => void }) {
  const [tab, setTab] = useState<'roster' | 'assignments'>('assignments');
  return (
    <div className="card class-detail">
      <h2>{cls?.name ?? 'Class'}{cls?.section ? ` · ${cls.section}` : ''}</h2>
      <div className="tabs" role="tablist" aria-label="Class">
        <button type="button" role="tab" aria-selected={tab === 'assignments'} className={tab === 'assignments' ? 'active' : ''} onClick={() => setTab('assignments')}>Assignments</button>
        <button type="button" role="tab" aria-selected={tab === 'roster'} className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>Roster (private)</button>
      </div>
      <div role="tabpanel">{tab === 'roster' ? <Roster brokerId={brokerId} classId={classId} onMessage={onMessage} /> : <Assignments brokerId={brokerId} classId={classId} onMessage={onMessage} />}</div>
    </div>
  );
}

function Roster({ brokerId, classId, onMessage }: { brokerId: string; classId: string; onMessage: (m: { kind: 'ok' | 'error'; text: string }) => void }) {
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void broker.getRoster(brokerId, classId).then((r) => setRows(r.map((x) => ({ studentNumber: x.studentNumber, name: x.name, email: x.email, status: x.status, bound: !!x.googleSub })))).catch((e: Error) => onMessage({ kind: 'error', text: e.message }));
  }, [brokerId, classId, onMessage]);
  if (!rows) return <p role="status">Loading roster…</p>;
  const set = (i: number, patch: Partial<EditRow>) => { setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r))); setDirty(true); };
  const importText = (text: string) => {
    const r = parseRosterCsv(text, classId);
    setProblems(r.problems.map((p) => `Line ${p.line}: ${p.message}`));
    if (r.rows.length) {
      const byNum = new Map(rows.map((x) => [x.studentNumber.toLowerCase(), x]));
      for (const n of r.rows) byNum.set(n.studentNumber.toLowerCase(), { studentNumber: n.studentNumber, name: n.name, email: n.email, status: n.status, bound: byNum.get(n.studentNumber.toLowerCase())?.bound });
      setRows([...byNum.values()]);
      setDirty(true);
    }
  };
  return (
    <div className="roster">
      <p className="field-hint">Only you can see this roster. It is stored in a private sheet in your Google Drive and never included in activities or reports, which show student numbers only. Students cannot choose or change their number: their Google account is linked to it the first time they open an assignment.</p>
      <div className="r-table-wrap">
        <table className="roster-table">
          <thead><tr><th scope="col">Student number</th><th scope="col">Name (optional, only you)</th><th scope="col">Student Google email</th><th scope="col">Status</th><th scope="col">Linked</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input type="text" aria-label={`Row ${i + 1} student number`} value={r.studentNumber} onChange={(e) => set(i, { studentNumber: e.target.value })} /></td>
                <td><input type="text" aria-label={`Row ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input type="email" aria-label={`Row ${i + 1} email`} value={r.email} onChange={(e) => set(i, { email: e.target.value })} /></td>
                <td>
                  <select aria-label={`Row ${i + 1} status`} value={r.status} onChange={(e) => set(i, { status: e.target.value as EditRow['status'] })}>
                    <option value="active">Active</option>
                    <option value="withdrawn">Withdrawn</option>
                  </select>
                </td>
                <td>{r.bound ? 'Yes' : '—'}</td>
                <td><button type="button" className="icon danger" aria-label={`Remove row ${i + 1}`} onClick={() => { setRows(rows.filter((_, k) => k !== i)); setDirty(true); }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => { setRows([...rows, { studentNumber: '', name: '', email: '', status: 'active' }]); setDirty(true); }}>+ Add student</button>
        <button type="button" className="secondary" onClick={() => file.current?.click()}>Import CSV…</button>
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden aria-label="Import roster CSV" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importText(await f.text()); }} />
        <button type="button" className="primary" disabled={!dirty} onClick={async () => {
          try {
            const saved = await broker.putRoster(brokerId, classId, rows.filter((r) => r.studentNumber.trim() || r.email.trim()));
            setRows(saved.map((x) => ({ studentNumber: x.studentNumber, name: x.name, email: x.email, status: x.status, bound: !!x.googleSub })));
            setDirty(false);
            setProblems([]);
            onMessage({ kind: 'ok', text: `Roster saved (${saved.length} students).` });
          } catch (err) {
            onMessage({ kind: 'error', text: (err as Error).message });
          }
        }}>Save roster</button>
      </div>
      <p className="field-hint">CSV columns: <code>student number, email</code> and optionally <code>name, status</code>. You can also paste from a spreadsheet into a .csv file. Use made-up test data until your school has approved the app.</p>
      {problems.length > 0 && <div className="notice error" role="alert"><ul>{problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}</ul></div>}
    </div>
  );
}

function Assignments({ brokerId, classId, onMessage }: { brokerId: string; classId: string; onMessage: (m: { kind: 'ok' | 'error'; text: string }) => void }) {
  const [list, setList] = useState<AssignmentInfo[] | null>(null);
  const [subs, setSubs] = useState<Record<string, SubmissionRow[]>>({});
  const load = useCallback(() => broker.listAssignments(brokerId, classId).then(setList).catch((e: Error) => onMessage({ kind: 'error', text: e.message })), [brokerId, classId, onMessage]);
  useEffect(() => void load(), [load]);
  if (!list) return <p role="status">Loading assignments…</p>;
  if (list.length === 0) return <p>No assignments yet. In the <a href="#/teacher">activity library</a>, publish an activity and choose <strong>Assign</strong>.</p>;
  return (
    <ul className="assignment-list">
      {list.map((a) => {
        const link = assignmentLink(appUrl(), a.assignmentId, brokerId);
        const s = subs[a.assignmentId];
        return (
          <li key={a.assignmentId} className="assignment-row">
            <div>
              <strong>{a.title}</strong>
              <p className="meta">
                {a.grading === 'hidden' ? 'Answers hidden (graded by your service)' : 'Graded on device, verified by your service'} · {a.maxAttempts ? `${a.maxAttempts} attempt(s)` : 'unlimited attempts'}
                {a.dueAt ? ` · due ${formatTime(a.dueAt)}` : ''}{a.closed ? ' · closed' : ''}
              </p>
              <div className="row wrap">
                <input type="text" readOnly aria-label={`Link for ${a.title}`} value={link} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); onMessage({ kind: 'ok', text: 'Link copied. Share it with students (e.g. in Google Classroom).' }); } catch { onMessage({ kind: 'error', text: 'Select the link and copy it.' }); } }}>Copy link</button>
                {isSimulation() && <a className="button ghost" href={`#/a/${encodeURIComponent(a.assignmentId)}?b=${encodeURIComponent(brokerId)}`}>Open link (switch to a fictional student first)</a>}
                <button type="button" className="ghost" onClick={async () => setSubs({ ...subs, [a.assignmentId]: await broker.listSubmissions(brokerId, a.assignmentId) })}>Submissions</button>
                <button type="button" className="ghost" onClick={async () => { await broker.updateAssignment(brokerId, a.assignmentId, { closed: !a.closed }); await load(); }}>{a.closed ? 'Reopen' : 'Close'}</button>
              </div>
              {s && (
                s.length === 0 ? <p className="meta">No submissions yet.</p> : (
                  <div className="r-table-wrap">
                    <table className="roster-table">
                      <thead><tr><th scope="col">Student</th><th scope="col">Attempt</th><th scope="col">Received</th><th scope="col">Verified score</th><th scope="col">Notes</th></tr></thead>
                      <tbody>
                        {s.map((x) => (
                          <tr key={x.receiptId}>
                            <td>{x.studentNumber}</td><td>{x.attemptNumber}</td><td>{formatTime(x.receivedAt)}</td>
                            <td>{x.score} / {x.maxScore}{x.needsReview ? ` (+${x.needsReview} to review)` : ''}</td>
                            <td>{String(x.late) === 'true' ? 'Late. ' : ''}{String(x.scoreMismatch) === 'true' ? 'Device score differed from verified score.' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
