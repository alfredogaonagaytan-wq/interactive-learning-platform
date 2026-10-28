import DOMPurify from 'dompurify';
import { blocksFromPlainText, checkMedia, IMAGE_TYPES, randomId, type Block, type ImageRef, type Run } from '@ilp/core';
import { putAsset } from '../storage/db';

/**
 * Deterministic converters from the teacher's source to reading blocks.
 * Nothing is summarised, paraphrased or "fixed": text is copied character for
 * character. The teacher reviews the result against the original and approves it.
 * External images are never fetched (untrusted links); embedded images are kept.
 */
const newId = () => randomId('blk');

export function importPlainText(text: string): Block[] {
  return blocksFromPlainText(text, newId);
}

async function storeDataImage(src: string, alt: string): Promise<ImageRef | null> {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  try {
    const bytes = m[2] ? Uint8Array.from(atob(m[3]!), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]!));
    const { id, mime } = await checkMedia(bytes, IMAGE_TYPES);
    await putAsset({ id, mime, bytes, name: 'imported-image', addedAt: new Date().toISOString() });
    return { assetId: id, alt, decorative: false };
  } catch {
    return null;
  }
}

type Marks = Pick<Run, 'b' | 'i' | 'u' | 'sup' | 'sub'>;

/**
 * Collect text runs following HTML's own whitespace rules (what the teacher sees
 * in the browser): source line breaks and repeated spaces collapse to one
 * space, <br> is a real line break, non-breaking spaces are kept.
 */
function runsOf(node: Node, marks: Marks = {}, out: Run[] = []): Run[] {
  const append = (t: string, m: Marks) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !!last.b === !!m.b && !!last.i === !!m.i && !!last.u === !!m.u && !!last.sup === !!m.sup && !!last.sub === !!m.sub) last.text += t;
    else out.push({ text: t, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v)) });
  };
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      append((child.textContent ?? '').replace(/[ \t\n\r\f]+/g, ' '), marks);
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      append('\n', marks);
      continue;
    }
    const style = child.getAttribute('style') ?? '';
    const next: Marks = {
      ...marks,
      ...((tag === 'b' || tag === 'strong' || /font-weight:\s*(bold|[6-9]00)/.test(style)) && { b: true }),
      ...((tag === 'i' || tag === 'em' || /font-style:\s*italic/.test(style)) && { i: true }),
      ...((tag === 'u' || /text-decoration[^;]*underline/.test(style)) && { u: true }),
      ...(tag === 'sup' && { sup: true }),
      ...(tag === 'sub' && { sub: true }),
    };
    runsOf(child, next, out);
  }
  return out;
}

/** Remove the collapsible spaces a browser would not display: at the block edges and around line breaks. */
function tidy(runs: Run[]): Run[] {
  const joined = runs.map((r) => r.text).join('');
  const keep: boolean[] = Array.from(joined, () => true);
  const chars = Array.from(joined);
  // drop leading/trailing collapsible spaces
  for (let i = 0; i < chars.length && chars[i] === ' '; i++) keep[i] = false;
  for (let i = chars.length - 1; i >= 0 && chars[i] === ' '; i--) keep[i] = false;
  chars.forEach((c, i) => {
    if (c === ' ' && (chars[i - 1] === '\n' || chars[i + 1] === '\n')) keep[i] = false;
  });
  const out: Run[] = [];
  let k = 0;
  for (const r of runs) {
    const cs = Array.from(r.text);
    const text = cs.filter((_, j) => keep[k + j]).join('');
    k += cs.length;
    if (text) out.push({ ...r, text });
  }
  return out;
}

export async function importHtml(html: string): Promise<{ blocks: Block[]; skippedImages: number }> {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption', 'img', 'blockquote', 'section', 'article', 'a'],
    ALLOWED_ATTR: ['src', 'alt', 'style'],
    ALLOW_DATA_ATTR: false,
  });
  const root = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html').body;
  const blocks: Block[] = [];
  let skipped = 0;
  const pushRuns = (kind: 'paragraph' | 'quote', el: Node) => {
    const runs = tidy(runsOf(el));
    if (runs.some((r) => r.text.trim())) blocks.push(kind === 'paragraph' ? { kind, id: newId(), runs, numbered: true } : { kind, id: newId(), runs });
  };
  const figure = async (img: HTMLImageElement, captionEl: Element | null) => {
    const src = img.getAttribute('src') ?? '';
    const alt = img.getAttribute('alt') ?? '';
    const image = src.startsWith('data:') ? await storeDataImage(src, alt) : null;
    if (!image) skipped++;
    const host = (() => { try { return new URL(src).host; } catch { return ''; } })();
    blocks.push({ kind: 'figure', id: newId(), image, caption: captionEl ? tidy(runsOf(captionEl)) : [], missing: image ? '' : `Image not imported${host ? ` (from ${host})` : ''}. External images are not downloaded — upload the image instead.` });
  };
  const walk = async (parent: Element) => {
    let inline: Node[] = [];
    const flushInline = () => {
      if (inline.length) {
        const frag = document.createElement('div');
        inline.forEach((n) => frag.appendChild(n.cloneNode(true)));
        pushRuns('paragraph', frag);
      }
      inline = [];
    };
    for (const node of Array.from(parent.childNodes)) {
      if (!(node instanceof HTMLElement)) {
        inline.push(node);
        continue;
      }
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        flushInline();
        const runs = tidy(runsOf(node));
        if (runs.length) blocks.push({ kind: 'heading', id: newId(), level: Math.min(4, Number(tag[1])), runs });
      } else if (tag === 'p') {
        flushInline();
        const imgs = Array.from(node.querySelectorAll('img'));
        for (const img of imgs) await figure(img, null);
        pushRuns('paragraph', node);
      } else if (tag === 'blockquote') {
        flushInline();
        pushRuns('quote', node);
      } else if (tag === 'ul' || tag === 'ol') {
        flushInline();
        const items = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === 'li').map((li) => tidy(runsOf(li)));
        if (items.length) blocks.push({ kind: 'list', id: newId(), ordered: tag === 'ol', items });
      } else if (tag === 'table') {
        flushInline();
        const cap = node.querySelector('caption');
        const rows = Array.from(node.querySelectorAll('tr')).map((tr) => Array.from(tr.children).filter((c) => /^t[hd]$/i.test(c.tagName)).map((cell) => ({ runs: tidy(runsOf(cell)), header: cell.tagName.toLowerCase() === 'th' })));
        blocks.push({ kind: 'table', id: newId(), caption: cap ? tidy(runsOf(cap)) : [], rows: rows.filter((r) => r.length) });
      } else if (tag === 'figure') {
        flushInline();
        const img = node.querySelector('img');
        if (img) await figure(img, node.querySelector('figcaption'));
      } else if (tag === 'img') {
        flushInline();
        await figure(node as HTMLImageElement, null);
      } else if (tag === 'div' || tag === 'section' || tag === 'article') {
        flushInline();
        // A div that only holds inline content is a paragraph; otherwise recurse.
        if (Array.from(node.children).some((c) => /^(p|div|h[1-6]|ul|ol|table|figure|blockquote|section|article|img)$/i.test(c.tagName))) await walk(node);
        else pushRuns('paragraph', node);
      } else {
        inline.push(node);
      }
    }
    flushInline();
  };
  await walk(root);
  return { blocks, skippedImages: skipped };
}

export async function importDocx(bytes: Uint8Array): Promise<{ blocks: Block[]; skippedImages: number; warnings: string[] }> {
  const mammoth = (await import('mammoth/mammoth.browser.js')) as unknown as { convertToHtml: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string; messages: Array<{ message: string }> }> };
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const r = await mammoth.convertToHtml({ arrayBuffer: ab });
  const h = await importHtml(r.value);
  return { ...h, warnings: r.messages.map((m) => m.message).slice(0, 10) };
}

/**
 * PDF: text is extracted page by page. Line breaks are kept exactly as laid out
 * (the teacher can join lines with one click after checking). Page boundaries
 * become page markers so the original page organisation is preserved.
 */
export async function importPdf(bytes: Uint8Array): Promise<{ blocks: Block[]; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const blocks: Block[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    type TItem = { str: string; transform: number[]; height: number; hasEOL?: boolean };
    const items = (content.items as TItem[]).filter((i) => typeof i.str === 'string');
    const lines: Array<{ y: number; h: number; text: string }> = [];
    for (const it of items) {
      const y = it.transform[5]!;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < Math.max(2, it.height * 0.4)) last.text += it.str;
      else if (it.str !== '' || it.hasEOL) lines.push({ y, h: it.height || 10, text: it.str });
    }
    if (pdf.numPages > 1) blocks.push({ kind: 'page', id: newId(), label: `Page ${p}` });
    let para: string[] = [];
    let prevY: number | null = null;
    let prevH = 10;
    const flush = () => {
      const text = para.join('\n').replace(/[ \t]+$/gm, '');
      if (text.trim()) blocks.push({ kind: 'paragraph', id: newId(), runs: [{ text }], numbered: true });
      para = [];
    };
    for (const line of lines) {
      if (prevY !== null && prevY - line.y > Math.max(line.h, prevH) * 1.6) flush();
      if (line.text.trim()) para.push(line.text);
      else flush();
      prevY = line.y;
      prevH = line.h;
    }
    flush();
  }
  return { blocks, pages: pdf.numPages };
}

/** Optional, explicit, reversible-by-undo transform the teacher chooses for PDF text: join wrapped lines with spaces. */
export function joinWrappedLines(block: Block): Block {
  if (block.kind !== 'paragraph' && block.kind !== 'quote') return block;
  return { ...block, runs: block.runs.map((r) => ({ ...r, text: r.text.replace(/([^\n])\n(?!\n)/g, '$1 ') })) };
}
