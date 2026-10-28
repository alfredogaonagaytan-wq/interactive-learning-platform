import { useEffect, useRef, useState } from 'react';
import { cloneItem, randomId, type Item } from '@ilp/core';
import { deleteBankEntry, listBank, putBankEntry, type BankEntry } from '../storage/db';
import { getPlugin } from '../plugins/registry';
import { itemSummary } from './itemSummary';

export async function saveToBank(item: Item, sourceActivityTitle: string, tags: string[] = []): Promise<void> {
  await putBankEntry({ id: randomId('bnk'), item: structuredClone(item), tags, sourceActivityTitle, savedAt: new Date().toISOString() });
}

/** Modal browser for the teacher's question bank. Inserted questions are copies with new ids. */
export function QuestionBankDialog({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (items: Item[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      void listBank().then(setEntries);
      setChosen(new Set());
      if (!d.open) (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', ''));
    } else if (d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = entries.filter((e) => !q || [itemSummary(e.item), e.tags.join(' '), e.sourceActivityTitle, getPlugin(e.item.type).label, ...('skills' in e.item ? e.item.skills : [])].join(' ').toLowerCase().includes(q));

  return (
    <dialog ref={ref} className="dialog wide" aria-labelledby="bank-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="bank-title">Question bank</h2>
      <p className="meta">Questions you saved from any activity. Inserting makes an independent copy.</p>
      <div className="field">
        <label htmlFor="bank-search">Search</label>
        <input id="bank-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Topic, skill, type…" />
      </div>
      {entries.length === 0 ? (
        <p>Your bank is empty. Use “Save to question bank” on any question.</p>
      ) : (
        <ul className="bank-list">
          {shown.map((e) => (
            <li key={e.id}>
              <label className="check">
                <input type="checkbox" checked={chosen.has(e.id)} onChange={(ev) => { const n = new Set(chosen); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setChosen(n); }} />
                <span>
                  <strong>{getPlugin(e.item.type).label}</strong> · {itemSummary(e.item)}
                  <span className="meta"> — from “{e.sourceActivityTitle}”{'skills' in e.item && e.item.skills.length ? ` · ${e.item.skills.join(', ')}` : ''}</span>
                </span>
              </label>
              <button type="button" className="icon danger" aria-label={`Delete from bank: ${itemSummary(e.item)}`} onClick={async () => { await deleteBankEntry(e.id); setEntries(await listBank()); }}>×</button>
            </li>
          ))}
          {shown.length === 0 && <li>No matches.</li>}
        </ul>
      )}
      <div className="actions end">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={chosen.size === 0} onClick={() => onInsert(entries.filter((e) => chosen.has(e.id)).map((e) => cloneItem(e.item)))}>
          Insert {chosen.size || ''} question{chosen.size === 1 ? '' : 's'}
        </button>
      </div>
    </dialog>
  );
}
