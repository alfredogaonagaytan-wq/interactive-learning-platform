import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cloneItem, createItem, getItemDefinition, hasUnpublishedChanges, PublishError, randomId, validateActivity, ZIP_PACKAGE_EXTENSION,
  type Activity, type ActivitySettings, type Item, type ItemType, type Pool, type ValidationIssue,
} from '@ilp/core';
import { getActivity, listVersions } from '../storage/db';
import { exportPackage, publish, saveDraft } from '../storage/library';
import { ADD_GROUPS, getPlugin } from '../plugins/registry';
import { QuestionBankDialog, saveToBank } from './QuestionBank';
import { itemSummary } from './itemSummary';
import { Checkbox, NumberField, Select, TextArea, TextField } from '../ui/fields';
import { downloadBytes, formatTime, safeFilename } from '../app/util';
import { useConfirm } from '../ui/dialog';

const SETTINGS = '__settings__';
const AUTOSAVE_MS = 500;

export function Editor({ id }: { id: string }) {
  const [activity, setActivity] = useState<Activity | null | undefined>(undefined);
  const [selected, setSelected] = useState<string>(SETTINGS);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<number>(0);
  const [bankOpen, setBankOpen] = useState(false);
  const pending = useRef<Activity | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    void getActivity(id).then((a) => setActivity(a ?? null));
    void listVersions(id).then((v) => setVersions(v.length));
  }, [id]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const a = pending.current;
    if (!a) return a;
    pending.current = null;
    try {
      const next = await saveDraft(a);
      setActivity((cur) => (cur && cur.id === next.id ? { ...cur, revision: next.revision, updatedAt: next.updatedAt } : cur));
      setSaved('saved');
      return next;
    } catch {
      pending.current = a;
      setSaved('error');
      return a;
    }
  }, []);

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  const update = (next: Activity) => {
    setActivity(next);
    pending.current = next;
    setSaved('saving');
    if (issues) setIssues(validateActivity(next));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  if (activity === undefined) return <p role="status">Loading…</p>;
  if (activity === null)
    return (
      <div className="card">
        <h1>Activity not found</h1>
        <p>It may have been deleted on this device.</p>
        <a href="#/teacher" className="button">Back to library</a>
      </div>
    );

  const setItem = (item: Item) => update({ ...activity, items: activity.items.map((i) => (i.id === item.id ? item : i)) });
  const setSettings = (patch: Partial<ActivitySettings>) => update({ ...activity, settings: { ...activity.settings, ...patch } });
  const addItem = (type: ItemType) => {
    const item = createItem(type);
    const idx = activity.items.findIndex((i) => i.id === selected);
    const items = [...activity.items];
    items.splice(idx === -1 ? items.length : idx + 1, 0, item);
    update({ ...activity, items });
    setSelected(item.id);
  };
  const moveItem = (idx: number, d: -1 | 1) => {
    const items = [...activity.items];
    const j = idx + d;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j]!, items[idx]!];
    update({ ...activity, items });
  };
  const duplicateItem = (item: Item) => {
    const copy = cloneItem(item);
    const idx = activity.items.findIndex((i) => i.id === item.id);
    const items = [...activity.items];
    items.splice(idx + 1, 0, copy);
    update({ ...activity, items });
    setSelected(copy.id);
  };
  const removeItem = async (item: Item) => {
    if (!(await confirm({ title: 'Delete this item?', body: itemSummary(item), confirmLabel: 'Delete', danger: true }))) return;
    update({ ...activity, items: activity.items.filter((i) => i.id !== item.id), pools: activity.pools.map((p) => ({ ...p, itemIds: p.itemIds.filter((id) => id !== item.id) })) });
    setSelected(SETTINGS);
  };
  const insertItems = (newItems: Item[]) => {
    const idx = activity.items.findIndex((i) => i.id === selected);
    const items = [...activity.items];
    items.splice(idx === -1 ? items.length : idx + 1, 0, ...newItems);
    update({ ...activity, items });
    setBankOpen(false);
    if (newItems[0]) setSelected(newItems[0].id);
    setNotice(`Inserted ${newItems.length} question${newItems.length === 1 ? '' : 's'} from the bank.`);
  };
  const setItemPool = (itemId: string, poolId: string | null) =>
    update({ ...activity, pools: activity.pools.map((p) => ({ ...p, itemIds: p.id === poolId ? [...p.itemIds.filter((x) => x !== itemId), itemId] : p.itemIds.filter((x) => x !== itemId) })) });
  const doExport = async () => {
    try {
      downloadBytes(`${safeFilename(activity.title)}${ZIP_PACKAGE_EXTENSION}`, await exportPackage([(await flush()) ?? activity]));
    } catch (e) {
      setNotice(`Could not export: ${(e as Error).message}`);
    }
  };

  const doPublish = async () => {
    const latest = (await flush()) ?? activity;
    const found = validateActivity(latest);
    setIssues(found);
    if (found.length > 0) {
      setNotice(null);
      return;
    }
    const ok = await confirm({
      title: latest.publishedVersion ? `Publish version ${latest.publishedVersion + 1}?` : 'Publish this activity?',
      body: latest.publishedVersion
        ? 'Students who already started or submitted earlier versions keep working on, and are graded against, the version they began.'
        : 'Publishing creates a fixed version that students complete. You can keep editing the draft and publish again later.',
      confirmLabel: 'Publish',
    });
    if (!ok) return;
    try {
      const { draft, version } = await publish(latest);
      setActivity(draft);
      setVersions(version.version);
      setNotice(`Published version ${version.version}. Students on this device can open it from the Student view.`);
    } catch (e) {
      if (e instanceof PublishError) setIssues(e.issues);
      else setNotice(`Could not publish: ${(e as Error).message}`);
    }
  };

  const sel = activity.items.find((i) => i.id === selected);
  const issuesFor = (itemId?: string) => (issues ?? []).filter((i) => i.itemId === itemId);
  let qn = 0;

  return (
    <div className="editor">
      <div className="page-head sticky">
        <div>
          <a href="#/teacher" className="back">← Library</a>
          <p className="meta" role="status" aria-live="polite">
            {saved === 'saving' ? 'Saving draft…' : saved === 'error' ? 'Could not save — retrying on next change' : `Draft saved · ${formatTime(activity.updatedAt)}`}
            {' · '}
            {activity.publishedVersion === null ? 'Not published' : hasUnpublishedChanges(activity) ? `Published v${activity.publishedVersion} (draft has unpublished changes)` : `Published v${activity.publishedVersion}`}
          </p>
        </div>
        <div className="actions">
          <a className="button ghost" href={`#/teacher/preview/${activity.id}?as=teacher`} onClick={() => void flush()}>Teacher preview</a>
          <a className="button secondary" href={`#/teacher/preview/${activity.id}?as=student`} onClick={() => void flush()}>Student preview</a>
          <button type="button" className="ghost" onClick={doExport}>Export</button>
          <button type="button" className="primary" onClick={doPublish}>Publish</button>
        </div>
      </div>

      {notice && <p className="notice ok" role="status">{notice}</p>}
      {issues && issues.length > 0 && (
        <div className="notice error" role="alert">
          <strong>Fix {issues.length} issue{issues.length === 1 ? '' : 's'} before publishing:</strong>
          <ul>
            {issues.map((iss, k) => (
              <li key={k}>
                {iss.itemId ? <button type="button" className="link" onClick={() => setSelected(iss.itemId!)}>{labelFor(activity, iss.itemId)}</button> : <button type="button" className="link" onClick={() => setSelected(SETTINGS)}>Details</button>}: {iss.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="editor-grid">
        <nav className="outline card" aria-label="Activity outline">
          <ol>
            <li>
              <button type="button" className={`outline-item ${selected === SETTINGS ? 'active' : ''}`} aria-current={selected === SETTINGS} onClick={() => setSelected(SETTINGS)}>
                <span className="outline-type">Details &amp; settings</span>
                <span className="outline-text">{activity.title || 'Untitled activity'}</span>
              </button>
            </li>
            {activity.items.map((item, idx) => {
              const scorable = getItemDefinition(item.type).scorable;
              const has = issuesFor(item.id).length > 0;
              const pool = activity.pools.find((p) => p.itemIds.includes(item.id));
              return (
                <li key={item.id}>
                  <button type="button" className={`outline-item ${selected === item.id ? 'active' : ''}`} aria-current={selected === item.id} onClick={() => setSelected(item.id)}>
                    <span className="outline-type">{scorable ? `Q${++qn} · ` : ''}{getPlugin(item.type).label}{pool && <span className="badge info">pool: {pool.name}</span>}{has && <span className="badge error-badge">needs fixing</span>}</span>
                    <span className="outline-text">{itemSummary(item)}</span>
                  </button>
                  <div className="icon-buttons">
                    <button type="button" className="icon" aria-label={`Move item ${idx + 1} up`} disabled={idx === 0} onClick={() => moveItem(idx, -1)}>↑</button>
                    <button type="button" className="icon" aria-label={`Move item ${idx + 1} down`} disabled={idx === activity.items.length - 1} onClick={() => moveItem(idx, 1)}>↓</button>
                  </div>
                </li>
              );
            })}
          </ol>
          <details className="add-menu" open={activity.items.length === 0}>
            <summary className="button secondary">+ Add item</summary>
            {ADD_GROUPS.map((g) => (
              <div key={g.label} className="add-group">
                <h3 className="add-group-label">{g.label}</h3>
                <ul>
                  {g.types.map((t) => (
                    <li key={t}>
                      <button type="button" className="add-option" onClick={(e) => { addItem(t); (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; }}>
                        <strong>{getPlugin(t).label}</strong>
                        <span>{getPlugin(t).description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <button type="button" className="add-option" onClick={(e) => { setBankOpen(true); (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; }}>
              <strong>From question bank…</strong>
              <span>Reuse questions you saved from other activities.</span>
            </button>
            <p className="field-hint">Audio, listening and speaking types arrive in Phase 3.</p>
          </details>
        </nav>

        <section className="panel card" aria-label={sel ? `Edit ${getPlugin(sel.type).label}` : 'Activity details and settings'}>
          {sel ? (
            <ItemPanel
              key={sel.id}
              item={sel}
              language={activity.language}
              pools={activity.pools}
              onPool={(poolId) => setItemPool(sel.id, poolId)}
              onChange={setItem}
              onDuplicate={() => duplicateItem(sel)}
              onDelete={() => removeItem(sel)}
              onSaveToBank={async () => { await saveToBank(sel, activity.title); setNotice('Saved a copy to your question bank.'); }}
            />
          ) : (
            <SettingsPanel activity={activity} versions={versions} onChange={update} setSettings={setSettings} />
          )}
        </section>
      </div>
      <QuestionBankDialog open={bankOpen} onClose={() => setBankOpen(false)} onInsert={insertItems} />
    </div>
  );
}

function labelFor(a: Activity, itemId: string): string {
  let qn = 0;
  for (const i of a.items) {
    const scorable = getItemDefinition(i.type).scorable;
    if (scorable) qn++;
    if (i.id === itemId) return scorable ? `Question ${qn}` : 'Text block';
  }
  return 'Item';
}

function ItemPanel({ item, language, pools, onPool, onChange, onDuplicate, onDelete, onSaveToBank }: {
  item: Item;
  language: string;
  pools: Pool[];
  onPool: (poolId: string | null) => void;
  onChange: (i: Item) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveToBank: () => void;
}) {
  const plugin = getPlugin(item.type);
  const Editor = plugin.Editor;
  const scorable = getItemDefinition(item.type).scorable;
  const pool = pools.find((p) => p.itemIds.includes(item.id));
  return (
    <>
      <div className="panel-head">
        <h2>{plugin.label}</h2>
        <div className="actions">
          {scorable && <button type="button" className="ghost" onClick={onSaveToBank}>Save to question bank</button>}
          <button type="button" className="ghost" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="ghost danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
      {scorable && pools.length > 0 && (
        <Select
          label="Question pool"
          value={pool?.id ?? ''}
          onChange={(v) => onPool(v || null)}
          options={[{ value: '', label: 'Always shown (not in a pool)' }, ...pools.map((p) => ({ value: p.id, label: `${p.name} (draw ${p.draw} of ${p.itemIds.length})` }))]}
        />
      )}
      <Editor item={item} onChange={onChange} language={language} />
    </>
  );
}

function SettingsPanel({ activity, versions, onChange, setSettings }: { activity: Activity; versions: number; onChange: (a: Activity) => void; setSettings: (p: Partial<ActivitySettings>) => void }) {
  const s = activity.settings;
  return (
    <>
      <div className="panel-head"><h2>Details</h2></div>
      <TextField label="Title" required value={activity.title} onChange={(title) => onChange({ ...activity, title })} />
      <TextArea label="Description for students" value={activity.description} onChange={(description) => onChange({ ...activity, description })} />
      <div className="grid-3">
        <TextField label="Language" hint="e.g. en, en-GB, ko, es" value={activity.language} onChange={(language) => onChange({ ...activity, language: language.trim() || 'en' })} />
        <TextField label="Subject" value={activity.subject} onChange={(subject) => onChange({ ...activity, subject })} />
        <TextField label="Grade / level" value={activity.gradeBand} onChange={(gradeBand) => onChange({ ...activity, gradeBand })} />
      </div>

      <h2>Attempts and feedback</h2>
      <div className="grid-2">
        <NumberField label="Submissions allowed" value={s.maxAttempts} min={1} max={100} nullable onChange={(maxAttempts) => setSettings({ maxAttempts })} />
        <Select
          label="When students see feedback"
          value={s.feedbackTiming}
          onChange={(feedbackTiming) => setSettings({ feedbackTiming })}
          options={[
            { value: 'immediate', label: 'While working (“Check” button)' },
            { value: 'on-submit', label: 'After submitting' },
            { value: 'after-release', label: 'Only when I release results' },
          ]}
        />
      </div>
      {s.feedbackTiming === 'immediate' && <NumberField label="Checks allowed per question" value={s.checksPerItem} min={1} max={20} nullable onChange={(checksPerItem) => setSettings({ checksPerItem })} />}
      <Select
        label="Show correct answers"
        value={s.answerReveal}
        onChange={(answerReveal) => setSettings({ answerReveal })}
        options={[
          { value: 'after-submit', label: 'After each submission' },
          { value: 'after-final-attempt', label: 'After the last allowed submission' },
          { value: 'after-release', label: 'Only when I release them' },
          { value: 'never', label: 'Never' },
        ]}
        hint="This hides answers from ordinary use. In this local version the answer key is stored on the device, so it is not secure against a determined, technical student."
      />
      <Checkbox label="Allow hints" checked={s.showHints} onChange={(showHints) => setSettings({ showHints })} />
      <Checkbox label="Shuffle question order for each attempt" checked={s.shuffleItems} onChange={(shuffleItems) => setSettings({ shuffleItems })} />
      <NumberField label="Target score (%)" hint="Reports show whether the target was met." value={s.passingPercent} min={0} max={100} nullable nullLabel="No target" onChange={(passingPercent) => setSettings({ passingPercent })} />
      <PoolsEditor pools={activity.pools} onChange={(pools) => onChange({ ...activity, pools })} />
      <p className="meta">Activity ID <code>{activity.id}</code> · {versions} published version{versions === 1 ? '' : 's'}</p>
    </>
  );
}

function PoolsEditor({ pools, onChange }: { pools: Pool[]; onChange: (p: Pool[]) => void }) {
  const set = (id: string, patch: Partial<Pool>) => onChange(pools.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <>
      <h2>Question pools</h2>
      <p className="field-hint">A pool shows each student a random selection of its questions (the same selection after a reload). Assign questions to a pool from each question’s panel.</p>
      {pools.map((p, i) => (
        <div key={p.id} className="pool-row">
          <TextField label={`Pool ${i + 1} name`} value={p.name} onChange={(name) => set(p.id, { name })} />
          <NumberField label="Questions to show" value={p.draw} min={1} max={500} onChange={(draw) => set(p.id, { draw: draw ?? 1 })} hint={`${p.itemIds.length} question${p.itemIds.length === 1 ? '' : 's'} in this pool`} />
          <button type="button" className="ghost danger" onClick={() => onChange(pools.filter((x) => x.id !== p.id))}>Remove pool</button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...pools, { id: randomId('pol'), name: `Pool ${pools.length + 1}`, draw: 1, itemIds: [] }])}>+ Add question pool</button>
    </>
  );
}
