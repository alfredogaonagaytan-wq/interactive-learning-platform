import { DriveImportButton } from '../google/DriveImportButton';
import { useRef, useState, type ClipboardEvent } from 'react';
import { checkMedia, DOCUMENT_TYPES, IMAGE_TYPES, isApproved, randomId, readingHash, runsText, sniffAnyType, type Block, type ReadingDoc } from '@ilp/core';
import { getAsset, putAsset } from '../storage/db';
import { Checkbox, TextField } from '../ui/fields';
import { RowControls, moveInArray } from '../ui/lists';
import { ImageField } from '../ui/media';
import { useConfirm } from '../ui/dialog';
import { blobBytes } from '../app/util';
import { importDocx, importHtml, importPdf, importPlainText, joinWrappedLines } from './importers';
import { ReadingView } from './ReadingView';

const KIND_LABEL: Record<Block['kind'], string> = { heading: 'Heading', paragraph: 'Paragraph', quote: 'Quotation', list: 'List', table: 'Table', figure: 'Figure', page: 'Page break' };

/** Keep the uploaded file exactly as it was, for comparison and for students to open. */
async function storeOriginal(bytes: Uint8Array, name: string): Promise<string | null> {
  try {
    const { id, mime } = await checkMedia(bytes, [...DOCUMENT_TYPES, ...IMAGE_TYPES]);
    await putAsset({ id, mime, bytes, name: name.slice(0, 120), addedAt: new Date().toISOString() });
    return id;
  } catch {
    return null;
  }
}

export function ReadingEditor({ doc, onChange }: { doc: ReadingDoc; onChange: (d: ReadingDoc) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const approved = isApproved(doc);
  const changedSinceApproval = !!doc.approval && !approved;

  const replace = async (blocks: Block[], original: ReadingDoc['original'], messages: string[] = []) => {
    if (doc.blocks.length > 0 && !(await confirm({ title: 'Replace the current reading?', body: 'The text below will be replaced by the new import. Students’ published versions are not affected.', confirmLabel: 'Replace' }))) return;
    onChange({ ...doc, blocks, original, approval: null });
    setNotes(messages);
  };

  const onFile = async (f: File) => {
    setBusy(`Importing ${f.name}…`);
    setNotes([]);
    try {
      const bytes = await blobBytes(f);
      const type = sniffAnyType(bytes);
      const isHtml = /\.html?$/i.test(f.name) && type === 'text/plain';
      const assetId = await storeOriginal(bytes, f.name);
      if (type === 'application/pdf') {
        const r = await importPdf(bytes);
        await replace(r.blocks, { assetId, kind: 'pdf', name: f.name }, [`Imported ${r.pages} page${r.pages === 1 ? '' : 's'}. PDF text keeps the original line breaks; check columns, headers/footers and hyphenation against the original.`]);
      } else if (type?.includes('wordprocessingml')) {
        const r = await importDocx(bytes);
        await replace(r.blocks, { assetId, kind: 'docx', name: f.name }, [...(r.skippedImages ? [`${r.skippedImages} image(s) could not be imported.`] : []), ...r.warnings]);
      } else if (isHtml) {
        const r = await importHtml(new TextDecoder().decode(bytes));
        await replace(r.blocks, { assetId, kind: 'html', name: f.name }, r.skippedImages ? [`${r.skippedImages} image(s) were not imported (external images are never downloaded).`] : []);
      } else if (type === 'text/plain') {
        await replace(importPlainText(new TextDecoder().decode(bytes)), { assetId, kind: 'text', name: f.name });
      } else if (type && type.startsWith('image/')) {
        await replace([{ kind: 'figure', id: randomId('blk'), image: assetId ? { assetId, alt: '', decorative: false } : null, caption: [], missing: '' }], { assetId, kind: 'image', name: f.name }, ['A scanned page is shown as an image. Add alt text, and paste the text below it if students should annotate it.']);
      } else {
        setNotes(['This file type is not supported. Use .docx, .pdf, .txt, .html or an image, or paste the text.']);
      }
    } catch (e) {
      setNotes([`Could not import this file: ${(e as Error).message}`]);
    } finally {
      setBusy(null);
    }
  };

  const onPaste = async (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) {
      const r = await importHtml(html);
      await replace(r.blocks, { assetId: null, kind: 'paste', name: 'Pasted text' }, r.skippedImages ? [`${r.skippedImages} image(s) were not imported (external images are never downloaded). Upload them as figures.`] : []);
    } else if (text) {
      await replace(importPlainText(text), { assetId: null, kind: 'paste', name: 'Pasted text' });
    }
  };

  const openOriginal = async () => {
    const id = doc.original?.assetId;
    const a = id ? await getAsset(id) : undefined;
    if (!a) return;
    // Opened as its own type (PDF/image/text) — never as HTML, so imported files cannot run scripts.
    const type = a.mime === 'text/plain' ? 'text/plain;charset=utf-8' : a.mime;
    const url = URL.createObjectURL(new Blob([a.bytes as Uint8Array<ArrayBuffer>], { type }));
    if (a.mime.includes('wordprocessingml')) {
      const link = document.createElement('a');
      link.href = url;
      link.download = a.name || 'original.docx';
      link.click();
    } else window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const setBlock = (i: number, b: Block) => onChange({ ...doc, blocks: doc.blocks.map((x, k) => (k === i ? b : x)) });
  const textOf = (b: Block) => ('runs' in b ? runsText(b.runs) : '');
  const formatted = (b: Block) => 'runs' in b && b.runs.some((r) => r.b || r.i || r.u || r.sup || r.sub);

  return (
    <div className="reading-editor">
      <div className="grid-2">
        <TextField label="Reading title (optional)" value={doc.title} onChange={(title) => onChange({ ...doc, title })} />
        <TextField label="Source / citation (optional)" value={doc.attribution} onChange={(attribution) => onChange({ ...doc, attribution })} />
      </div>
      <div className="import-row">
        <div
          className="paste-box"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Paste the reading here"
          aria-multiline="true"
          tabIndex={0}
          onPaste={onPaste}
          onKeyDown={(e) => { if (!(e.ctrlKey || e.metaKey)) e.preventDefault(); }}
        >
          Paste the reading here (from a document, a website or Google Docs)
        </div>
        <div className="import-actions">
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>Upload a file…</button>
          <DriveImportButton mimeTypes="application/vnd.google-apps.document,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/plain,image/png,image/jpeg,image/webp" title="Choose a reading" disabled={!!busy} onError={(m) => setNotes([m])} onFile={(d) => onFile(new File([d.bytes as Uint8Array<ArrayBuffer>], d.name, { type: d.mime }))} />
          <span className="field-hint">.docx, .pdf, .txt, .html or a scanned page image</span>
          <input ref={fileRef} type="file" hidden aria-label="Upload reading file" accept=".docx,.pdf,.txt,.html,.htm,image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </div>
      </div>
      {busy && <p role="status">{busy}</p>}
      {notes.map((n, i) => <p key={i} className="notice info">{n}</p>)}

      {doc.blocks.length > 0 && (
        <>
          <div className="row wrap">
            <Checkbox label="Number paragraphs in the margin" checked={doc.numbering} onChange={(numbering) => onChange({ ...doc, numbering })} />
            {doc.original?.assetId && <button type="button" className="secondary" onClick={openOriginal}>Open the original ({doc.original.name})</button>}
            {doc.original?.kind === 'pdf' && (
              <button type="button" className="ghost" onClick={() => onChange({ ...doc, blocks: doc.blocks.map(joinWrappedLines), approval: null })}>Join wrapped lines in paragraphs</button>
            )}
            <button type="button" className="ghost" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? 'Hide student view' : 'Show student view'}</button>
          </div>
          {preview && <div className="reading-preview card"><ReadingView doc={doc} annotations={[]} symbols={[]} /></div>}
          <ol className="block-list" aria-label="Reading blocks">
            {doc.blocks.map((b, i) => (
              <li key={b.id} className={`block-row kind-${b.kind}`}>
                <div className="row">
                  <strong className="block-kind">{KIND_LABEL[b.kind]}</strong>
                  {(b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'quote') && (
                    <select aria-label={`Block ${i + 1} type`} value={b.kind === 'heading' ? `h${b.level}` : b.kind} onChange={(e) => {
                      const v = e.target.value;
                      const runs = b.runs;
                      setBlock(i, v.startsWith('h') ? { kind: 'heading', id: b.id, level: Number(v[1]), runs } : v === 'quote' ? { kind: 'quote', id: b.id, runs } : { kind: 'paragraph', id: b.id, runs, numbered: true });
                    }}>
                      <option value="paragraph">Paragraph</option>
                      <option value="h1">Heading 1</option>
                      <option value="h2">Heading 2</option>
                      <option value="h3">Heading 3</option>
                      <option value="quote">Quotation</option>
                    </select>
                  )}
                  {b.kind === 'paragraph' && (
                    <label className="check"><input type="checkbox" checked={b.numbered} onChange={(e) => setBlock(i, { ...b, numbered: e.target.checked })} /> Numbered</label>
                  )}
                  <RowControls index={i} count={doc.blocks.length} label={`block ${i + 1}`} onMove={(a, c) => onChange({ ...doc, blocks: moveInArray(doc.blocks, a, c) })} onRemove={() => onChange({ ...doc, blocks: doc.blocks.filter((_, k) => k !== i) })} />
                  {(b.kind === 'paragraph' || b.kind === 'quote') && i < doc.blocks.length - 1 && 'runs' in doc.blocks[i + 1]! && (
                    <button type="button" className="ghost small" onClick={() => {
                      const next = doc.blocks[i + 1] as Extract<Block, { runs: unknown }>;
                      const merged = { ...b, runs: [...b.runs, { text: '\n' }, ...next.runs] } as Block;
                      onChange({ ...doc, blocks: doc.blocks.flatMap((x, k) => (k === i ? [merged] : k === i + 1 ? [] : [x])) });
                    }}>Merge with next</button>
                  )}
                </div>
                {'runs' in b ? (
                  <>
                    <textarea
                      aria-label={`Block ${i + 1} text`}
                      rows={Math.min(8, Math.max(2, Math.ceil(textOf(b).length / 90)))}
                      value={textOf(b)}
                      onChange={(e) => setBlock(i, { ...b, runs: [{ text: e.target.value }] } as Block)}
                    />
                    {formatted(b) && <p className="field-hint">Has bold/italic. Editing this block’s text removes its formatting.</p>}
                  </>
                ) : b.kind === 'figure' ? (
                  <ImageField label={`Figure ${i + 1}`} value={b.image} onChange={(image) => setBlock(i, { ...b, image, missing: image ? '' : b.missing })} />
                ) : b.kind === 'page' ? (
                  <input type="text" aria-label={`Block ${i + 1} label`} value={b.label} onChange={(e) => setBlock(i, { ...b, label: e.target.value })} />
                ) : (
                  <p className="field-hint">{b.kind === 'table' ? `${b.rows.length} rows — shown exactly as imported.` : `${b.items.length} items — shown exactly as imported.`}</p>
                )}
              </li>
            ))}
          </ol>
          <div className={`approval card ${approved ? 'is-approved' : ''}`}>
            {approved ? (
              <p><strong>Approved</strong> on {new Date(doc.approval!.approvedAt).toLocaleString()}. Any change to the text will require approval again.</p>
            ) : (
              <>
                {changedSinceApproval && <p className="notice error" role="alert">The reading changed after you approved it. Check it again.</p>}
                <label className="check">
                  <input type="checkbox" checked={false} onChange={() => onChange({ ...doc, approval: { hash: readingHash(doc), approvedAt: new Date().toISOString() } })} />
                  I compared this text with the original. It is complete and accurate, and students may see it.
                </label>
                <p className="field-hint">The activity cannot be published until the reading is approved.</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
