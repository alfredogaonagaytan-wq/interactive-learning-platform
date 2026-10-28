import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  paragraphNumbers, randomId, readingUnits, SYMBOL_COLORS, SYMBOL_PRESETS, validAnnotations,
  type Annotation, type ObservationNotesItem, type ObservationNotesResponse, type ObservationSymbol, type Unit,
} from '@ilp/core';
import { Checkbox, NumberField, Select, SkillsField, TextArea, TextField } from '../../ui/fields';
import { RowControls, moveInArray } from '../../ui/lists';
import { ReadingEditor } from '../../reading/ReadingEditor';
import { rangeOffsets, ReadingView } from '../../reading/ReadingView';
import { WritingPanel, WritingTaskEditor, type EvidenceOption } from '../../reading/Writing';
import { FRAMEWORK_PRESETS } from '@ilp/core';
import type { ItemPlugin } from '../types';

type Tab = 'reading' | 'symbols' | 'questions' | 'writing' | 'scoring';

function unitLabel(u: Unit, nums: Map<string, number>): string {
  const n = u.paragraph ?? nums.get(u.blockId);
  const t = u.text.replace(/\s+/g, ' ').slice(0, 50);
  return n ? `¶${n}: ${t}` : t;
}

export const observationNotesPlugin: ItemPlugin<ObservationNotesItem, ObservationNotesResponse> = {
  type: 'observation-notes',
  label: 'Observation notes',
  description: 'Cornell-style notes on a reading: highlight with symbols, answer paragraph questions, then write (CER, TCTAC, Toulmin…).',
  Editor({ item, onChange }) {
    const [tab, setTab] = useState<Tab>('reading');
    const units = useMemo(() => readingUnits(item.reading), [item.reading]);
    const nums = useMemo(() => paragraphNumbers(item.reading), [item.reading]);
    const setSym = (i: number, patch: Partial<ObservationSymbol>) => onChange({ ...item, symbols: item.symbols.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
    const tabs: Array<[Tab, string]> = [['reading', 'Reading'], ['symbols', 'Symbols'], ['questions', 'Questions'], ['writing', 'Notes & writing'], ['scoring', 'Scoring']];
    return (
      <>
        <TextField label="Title" value={item.title} onChange={(title) => onChange({ ...item, title })} />
        <TextArea label="Instructions for students" rows={2} value={item.instructions} onChange={(instructions) => onChange({ ...item, instructions })} />
        <div className="tabs" role="tablist" aria-label="Observation notes settings">
          {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div role="tabpanel" className="tabpanel">
          {tab === 'reading' && <ReadingEditor doc={item.reading} onChange={(reading) => onChange({ ...item, reading })} />}
          {tab === 'symbols' && (
            <>
              <Select label="Start from a preset" value="" onChange={(v) => v && onChange({ ...item, symbols: SYMBOL_PRESETS[v as keyof typeof SYMBOL_PRESETS].symbols(), minAnnotations: {} })} options={[{ value: '', label: 'Choose a preset…' }, ...Object.entries(SYMBOL_PRESETS).map(([k, p]) => ({ value: k as '' , label: p.label }))] as Array<{ value: ''; label: string }>} />
              <fieldset>
                <legend>Observation symbols</legend>
                {item.symbols.map((s, i) => (
                  <div key={s.id} className="symbol-row">
                    <span className={`obs-chip obs-${s.color}`} aria-hidden="true">{s.code || '?'}</span>
                    <input type="text" aria-label={`Symbol ${i + 1} code`} maxLength={4} value={s.code} onChange={(e) => setSym(i, { code: e.target.value })} />
                    <input type="text" aria-label={`Symbol ${i + 1} name`} value={s.label} onChange={(e) => setSym(i, { label: e.target.value })} />
                    <select aria-label={`Symbol ${i + 1} colour`} value={s.color} onChange={(e) => setSym(i, { color: e.target.value as ObservationSymbol['color'] })}>
                      {SYMBOL_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input type="number" aria-label={`Minimum ${s.label} marks`} title="Minimum marks required" min={0} max={100} value={item.minAnnotations[s.id] ?? 0} onChange={(e) => onChange({ ...item, minAnnotations: { ...item.minAnnotations, [s.id]: Math.max(0, e.target.valueAsNumber || 0) } })} />
                    <RowControls index={i} count={item.symbols.length} label={`symbol ${i + 1}`} minCount={1} onMove={(a, b) => onChange({ ...item, symbols: moveInArray(item.symbols, a, b) })} onRemove={() => onChange({ ...item, symbols: item.symbols.filter((_, k) => k !== i) })} />
                    <input type="text" className="symbol-desc" aria-label={`Symbol ${i + 1} description`} placeholder="What students should mark" value={s.description} onChange={(e) => setSym(i, { description: e.target.value })} />
                  </div>
                ))}
                <p className="field-hint">The number box is the minimum marks required for that symbol (0 = optional). Colours are always paired with the code, so meaning never depends on colour alone.</p>
                <button type="button" className="secondary" disabled={item.symbols.length >= 12} onClick={() => onChange({ ...item, symbols: [...item.symbols, { id: randomId('sym'), code: 'NEW', label: 'New symbol', description: '', color: 'slate' }] })}>+ Add symbol</button>
              </fieldset>
            </>
          )}
          {tab === 'questions' && (
            <fieldset>
              <legend>Questions attached to paragraphs</legend>
              {units.length === 0 && <p className="field-hint">Add the reading first.</p>}
              {item.prompts.map((p, i) => (
                <div key={p.id} className="prompt-row">
                  <select aria-label={`Question ${i + 1} paragraph`} value={p.unitId} onChange={(e) => onChange({ ...item, prompts: item.prompts.map((x, k) => (k === i ? { ...x, unitId: e.target.value } : x)) })}>
                    {units.map((u) => <option key={u.id} value={u.id}>{unitLabel(u, nums)}</option>)}
                  </select>
                  <input type="text" aria-label={`Question ${i + 1} text`} value={p.question} placeholder="What evidence does the author give?" onChange={(e) => onChange({ ...item, prompts: item.prompts.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)) })} />
                  <RowControls index={i} count={item.prompts.length} label={`question ${i + 1}`} onMove={(a, b) => onChange({ ...item, prompts: moveInArray(item.prompts, a, b) })} onRemove={() => onChange({ ...item, prompts: item.prompts.filter((_, k) => k !== i) })} />
                </div>
              ))}
              <button type="button" className="secondary" disabled={units.length === 0} onClick={() => onChange({ ...item, prompts: [...item.prompts, { id: randomId('prm'), unitId: units.find((u) => u.paragraph !== null)?.id ?? units[0]!.id, question: '' }] })}>+ Add question</button>
              <Checkbox label="Students must answer every question" checked={item.answerAllPrompts} onChange={(answerAllPrompts) => onChange({ ...item, answerAllPrompts })} />
            </fieldset>
          )}
          {tab === 'writing' && (
            <>
              <fieldset>
                <legend>Cornell notes</legend>
                <Checkbox label="Include Cornell notes (cues/questions, notes, summary)" checked={item.cornell.enabled} onChange={(enabled) => onChange({ ...item, cornell: { ...item.cornell, enabled } })} />
                {item.cornell.enabled && <NumberField label="Summary: minimum words" value={item.cornell.summaryMinWords} min={0} max={1000} onChange={(v) => onChange({ ...item, cornell: { ...item.cornell, summaryMinWords: v ?? 0 } })} />}
              </fieldset>
              <Checkbox label="Include a final writing task" checked={item.writing !== null} onChange={(on) => onChange({ ...item, writing: on ? { framework: 'cer', prompt: '', sections: FRAMEWORK_PRESETS.cer.sections(), minCitations: 1, requiredTerms: [], rubric: [], successCriteria: [], rubricSelfAssessment: false } : null })} />
              {item.writing && <WritingTaskEditor task={item.writing} onChange={(writing) => onChange({ ...item, writing })} />}
            </>
          )}
          {tab === 'scoring' && (
            <>
              <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[
                { value: 'teacher-review', label: 'I will review and score (rubric if provided)' },
                { value: 'completion', label: 'Points for meeting the checklist requirements' },
                { value: 'none', label: 'No points' },
              ]} />
              {item.scoring !== 'none' && !(item.scoring === 'teacher-review' && item.writing?.rubric.length) && <NumberField label="Points" value={item.points} min={0} max={1000} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />}
              <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
            </>
          )}
        </div>
      </>
    );
  },
  Player({ item, response, onChange, disabled, label, ctx }) {
    return <ObservationWorkspace item={item} response={response} onChange={onChange} disabled={disabled} label={label} showKey={ctx?.mode === 'teacher-preview'} />;
  },
};

type NotesTab = 'observations' | 'questions' | 'cornell' | 'writing';
const EMPTY_NOTES: ObservationNotesResponse = { annotations: [], prompts: {}, cues: [], notes: '', summary: '', sections: {}, successChecks: {}, rubricSelf: {} };

function ObservationWorkspace({ item, response, onChange, disabled, label }: { item: ObservationNotesItem; response: ObservationNotesResponse; onChange: (r: ObservationNotesResponse) => void; disabled: boolean; label: string; showKey: boolean }) {
  const r: ObservationNotesResponse = { ...EMPTY_NOTES, ...(response as Partial<ObservationNotesResponse>) };
  const units = useMemo(() => readingUnits(item.reading), [item.reading]);
  const nums = useMemo(() => paragraphNumbers(item.reading), [item.reading]);
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const anns = validAnnotations(item.reading, r.annotations);
  const [tab, setTab] = useState<NotesTab>('observations');
  const [mobileView, setMobileView] = useState<'reading' | 'notes'>('reading');
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<{ unitId: string; start: number; end: number; quote: string; x: number; y: number } | null>(null);
  const [selMsg, setSelMsg] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const readingRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const symById = new Map(item.symbols.map((s) => [s.id, s]));
  const promptUnits = new Set(item.prompts.map((p) => p.unitId));
  const paraOf = (unitId: string) => {
    const u = unitById.get(unitId);
    return u ? (u.paragraph ?? nums.get(u.blockId) ?? null) : null;
  };

  const add = (a: Omit<Annotation, 'id' | 'note'>) => {
    const ann: Annotation = { ...a, id: randomId('ann'), note: '' };
    onChange({ ...r, annotations: [...r.annotations, ann] });
    setActive(ann.id);
    setTab('observations');
    setAnnounce(`Marked “${a.quote.slice(0, 60)}” as ${symById.get(a.symbolId)?.label}.`);
    requestAnimationFrame(() => document.getElementById(`note-${ann.id}`)?.focus({ preventScroll: true }));
  };

  // Text selection inside one unit → floating symbol toolbar.
  const checkSelection = useCallback(() => {
    if (disabled) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPending(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const root = readingRef.current;
    if (!root || !root.contains(range.commonAncestorContainer)) return;
    const startUnit = (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest('[data-unit-id]');
    const endUnit = (range.endContainer.nodeType === 1 ? (range.endContainer as Element) : range.endContainer.parentElement)?.closest('[data-unit-id]');
    if (!startUnit || startUnit !== endUnit) {
      setPending(null);
      setSelMsg('Select words within one paragraph to mark them.');
      return;
    }
    const off = rangeOffsets(startUnit, range);
    const unitId = startUnit.getAttribute('data-unit-id')!;
    const text = unitById.get(unitId)?.text ?? '';
    if (!off || off.end <= off.start) return;
    // Trim surrounding spaces from the selection so the anchor is exact.
    let { start, end } = off;
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (end <= start) return;
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : startUnit.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    setSelMsg(null);
    setPending({ unitId, start, end, quote: text.slice(start, end), x: rect.left - box.left + rect.width / 2, y: rect.bottom - box.top + root.scrollTop + 6 });
  }, [disabled, unitById]);

  useEffect(() => {
    const onSel = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) setPending(null);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const evidence: EvidenceOption[] = anns.map((a) => {
    const p = paraOf(a.unitId);
    const q = a.quote.length > 140 ? `${a.quote.slice(0, 140)}…` : a.quote;
    return { id: a.id, label: `${symById.get(a.symbolId)?.code ?? ''} ${p ? `¶${p}` : ''} “${q.slice(0, 60)}”`, insert: `“${q}”${p ? ` (¶${p})` : ''}` };
  });

  const tabs: Array<[NotesTab, string, number | null]> = [
    ['observations', 'Observations', anns.length],
    ...(item.prompts.length ? [['questions', 'Questions', item.prompts.filter((p) => (r.prompts[p.id] ?? '').trim()).length] as [NotesTab, string, number]] : []),
    ...(item.cornell.enabled ? [['cornell', 'Cornell notes', null] as [NotesTab, string, null]] : []),
    ...(item.writing ? [['writing', 'Writing', null] as [NotesTab, string, null]] : []),
  ];

  return (
    <div className="obs-workspace" role="group" aria-label={`${label}: ${item.title || 'Observation notes'}`}>
      {item.title && <h3>{item.title}</h3>}
      {item.instructions && <p className="preserve-lines">{item.instructions}</p>}
      <div className="legend" aria-label="Observation symbols">
        {item.symbols.map((s) => <span key={s.id} className="legend-item"><span className={`obs-chip obs-${s.color}`}>{s.code}</span> {s.label}{item.minAnnotations[s.id] ? ` (at least ${item.minAnnotations[s.id]})` : ''}</span>)}
      </div>
      <div className="segmented mobile-switch" role="group" aria-label="Show">
        <button type="button" aria-pressed={mobileView === 'reading'} onClick={() => setMobileView('reading')}>Reading</button>
        <button type="button" aria-pressed={mobileView === 'notes'} onClick={() => setMobileView('notes')}>Notes ({anns.length})</button>
      </div>
      <div className={`obs-panes show-${mobileView}`}>
        <div className="obs-reading" ref={readingRef} onMouseUp={checkSelection} onKeyUp={checkSelection} onTouchEnd={() => setTimeout(checkSelection, 50)}>
          {!disabled && <p className="instruction">Select words in the text, then choose a symbol. Or use “Add an observation” in the notes panel.</p>}
          {selMsg && <p className="notice info" role="status">{selMsg}</p>}
          <ReadingView
            doc={item.reading}
            annotations={anns}
            symbols={item.symbols}
            activeId={active}
            onAnnotationClick={(id) => { setActive(id); setTab('observations'); setMobileView('notes'); requestAnimationFrame(() => document.getElementById(`note-${id}`)?.focus()); }}
            promptUnits={promptUnits}
            onPromptClick={(unitId) => { setTab('questions'); setMobileView('notes'); const p = item.prompts.find((x) => x.unitId === unitId); requestAnimationFrame(() => p && document.getElementById(`prompt-${p.id}`)?.focus()); }}
          />
          {pending && (
            <div className="sel-toolbar" style={{ left: Math.max(8, pending.x), top: pending.y }} role="toolbar" aria-label="Mark selected words as">
              {item.symbols.map((s) => (
                <button key={s.id} type="button" className={`obs-chip obs-${s.color}`} title={s.label} aria-label={`Mark as ${s.label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { add({ unitId: pending.unitId, start: pending.start, end: pending.end, quote: pending.quote, symbolId: s.id }); setPending(null); window.getSelection()?.removeAllRanges(); }}>
                  {s.code}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="obs-notes" aria-label="Notes">
          <div className="tabs" role="tablist" aria-label="Notes sections">
            {tabs.map(([k, l, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}{n !== null ? ` (${n})` : ''}</button>)}
          </div>
          <div role="tabpanel" className="tabpanel">
            {tab === 'observations' && (
              <>
                {!disabled && <AddObservation formId={formId} units={units} nums={nums} symbols={item.symbols} onAdd={add} />}
                {anns.length === 0 && <p className="meta">No observations yet.</p>}
                {item.symbols.map((s) => {
                  const list = anns.filter((a) => a.symbolId === s.id);
                  if (!list.length) return null;
                  return (
                    <section key={s.id} className="obs-group">
                      <h4><span className={`obs-chip obs-${s.color}`}>{s.code}</span> {s.label} ({list.length})</h4>
                      <ul>
                        {list.map((a) => {
                          const p = paraOf(a.unitId);
                          return (
                            <li key={a.id} className={active === a.id ? 'is-active' : ''}>
                              <blockquote>“{a.quote}”{p ? <span className="meta"> ¶{p}</span> : null}</blockquote>
                              <label className="sr-only" htmlFor={`note-${a.id}`}>Note about “{a.quote.slice(0, 40)}”</label>
                              <textarea id={`note-${a.id}`} rows={2} placeholder="Your note (why you marked this)" disabled={disabled} value={a.note} onFocus={() => setActive(a.id)} onChange={(e) => onChange({ ...r, annotations: r.annotations.map((x) => (x.id === a.id ? { ...x, note: e.target.value } : x)) })} />
                              {!disabled && (
                                <div className="row">
                                  <select aria-label="Change symbol" value={a.symbolId} onChange={(e) => onChange({ ...r, annotations: r.annotations.map((x) => (x.id === a.id ? { ...x, symbolId: e.target.value } : x)) })}>
                                    {item.symbols.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.label}</option>)}
                                  </select>
                                  <button type="button" className="ghost danger small" onClick={() => { onChange({ ...r, annotations: r.annotations.filter((x) => x.id !== a.id) }); setAnnounce('Observation removed.'); }}>Remove</button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </>
            )}
            {tab === 'questions' && (
              <ol className="prompt-answers">
                {item.prompts.map((p) => {
                  const u = unitById.get(p.unitId);
                  const n = paraOf(p.unitId);
                  return (
                    <li key={p.id}>
                      <label htmlFor={`prompt-${p.id}`}><strong>{n ? `¶${n}: ` : ''}</strong>{p.question}</label>
                      {u && <button type="button" className="link small-link" onClick={() => { setMobileView('reading'); document.querySelector(`[data-unit-id="${CSS.escape(u.id)}"]`)?.scrollIntoView({ block: 'center' }); }}>Show in text</button>}
                      <textarea id={`prompt-${p.id}`} rows={3} disabled={disabled} value={r.prompts[p.id] ?? ''} onChange={(e) => onChange({ ...r, prompts: { ...r.prompts, [p.id]: e.target.value } })} />
                    </li>
                  );
                })}
              </ol>
            )}
            {tab === 'cornell' && (
              <div className="cornell">
                <div className="cornell-grid">
                  <div className="cornell-cues">
                    <h4>Cues and questions</h4>
                    {r.cues.map((c, i) => (
                      <div key={c.id} className="row">
                        <input type="text" aria-label={`Cue ${i + 1}`} disabled={disabled} value={c.text} onChange={(e) => onChange({ ...r, cues: r.cues.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} />
                        {!disabled && <button type="button" className="icon danger" aria-label={`Remove cue ${i + 1}`} onClick={() => onChange({ ...r, cues: r.cues.filter((x) => x.id !== c.id) })}>×</button>}
                      </div>
                    ))}
                    {!disabled && <button type="button" className="ghost small" onClick={() => onChange({ ...r, cues: [...r.cues, { id: randomId('chc'), text: '' }] })}>+ Add cue</button>}
                  </div>
                  <div className="cornell-notes">
                    <label htmlFor={`${formId}-notes`}><h4>Notes</h4></label>
                    <textarea id={`${formId}-notes`} rows={10} disabled={disabled} value={r.notes} onChange={(e) => onChange({ ...r, notes: e.target.value })} />
                  </div>
                </div>
                <label htmlFor={`${formId}-summary`}><h4>Summary{item.cornell.summaryMinWords ? ` (at least ${item.cornell.summaryMinWords} words)` : ''}</h4></label>
                <textarea id={`${formId}-summary`} rows={4} disabled={disabled} value={r.summary} onChange={(e) => onChange({ ...r, summary: e.target.value })} />
              </div>
            )}
            {tab === 'writing' && item.writing && (
              <WritingPanel task={item.writing} value={r} disabled={disabled} evidence={evidence} onChange={(w) => onChange({ ...r, ...w })} />
            )}
          </div>
        </aside>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
    </div>
  );
}

/** Keyboard / screen-reader / touch alternative to selecting text: choose the paragraph, type the exact words. */
function AddObservation({ formId, units, nums, symbols, onAdd }: { formId: string; units: Unit[]; nums: Map<string, number>; symbols: ObservationSymbol[]; onAdd: (a: Omit<Annotation, 'id' | 'note'>) => void }) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  const [words, setWords] = useState('');
  const [symbolId, setSymbolId] = useState(symbols[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" className="secondary" onClick={() => setOpen(true)}>+ Add an observation</button>;
  return (
    <form className="add-obs card" onSubmit={(e) => {
      e.preventDefault();
      const u = units.find((x) => x.id === unitId);
      if (!u) return;
      const w = words.trim();
      const start = w ? u.text.indexOf(w) : 0;
      if (w && start === -1) return setError('Those exact words are not in that paragraph. Copy them from the text (spelling and punctuation must match).');
      const end = w ? start + w.length : u.text.length;
      onAdd({ unitId, start, end, quote: u.text.slice(start, end), symbolId });
      setWords('');
      setError(null);
      setOpen(false);
    }}>
      <label htmlFor={`${formId}-unit`}>Paragraph</label>
      <select id={`${formId}-unit`} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        {units.map((u) => <option key={u.id} value={u.id}>{unitLabel(u, nums)}</option>)}
      </select>
      <label htmlFor={`${formId}-words`}>Exact words (leave empty to mark the whole paragraph)</label>
      <input id={`${formId}-words`} type="text" value={words} onChange={(e) => setWords(e.target.value)} />
      <label htmlFor={`${formId}-sym`}>Symbol</label>
      <select id={`${formId}-sym`} value={symbolId} onChange={(e) => setSymbolId(e.target.value)}>
        {symbols.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.label}</option>)}
      </select>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary">Add</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
