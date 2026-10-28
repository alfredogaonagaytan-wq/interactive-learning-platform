import { z } from 'zod';
import { IdSchema, ImageRefSchema, ShortTextSchema } from '../schema/common';
import { canonicalJson, sha256HexSync } from '../hash';

/**
 * A reading as students see it: an ordered list of blocks with the original
 * wording, punctuation, line breaks, emphasis, tables, figures and page breaks.
 *
 * The app never rewrites or paraphrases a reading. Importers convert the
 * teacher's file deterministically; the teacher reviews the result against the
 * original and approves it. Approval stores a hash of the blocks, and any later
 * change invalidates it until the teacher approves again.
 */
export const RunSchema = z.object({
  text: z.string().max(50_000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional(),
  sup: z.boolean().optional(),
  sub: z.boolean().optional(),
});
export type Run = z.infer<typeof RunSchema>;
const Runs = z.array(RunSchema).max(2000);

export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), id: IdSchema, level: z.number().int().min(1).max(4), runs: Runs }),
  z.object({ kind: z.literal('paragraph'), id: IdSchema, runs: Runs, /** false = no margin number (e.g. the source already numbers its paragraphs) */ numbered: z.boolean().default(true) }),
  z.object({ kind: z.literal('quote'), id: IdSchema, runs: Runs }),
  z.object({ kind: z.literal('list'), id: IdSchema, ordered: z.boolean(), items: z.array(Runs).max(500) }),
  z.object({ kind: z.literal('table'), id: IdSchema, caption: Runs.default([]), rows: z.array(z.array(z.object({ runs: Runs, header: z.boolean().default(false) })).max(50)).max(500) }),
  z.object({ kind: z.literal('figure'), id: IdSchema, image: ImageRefSchema.nullable(), caption: Runs.default([]), /** shown when an image could not be imported */ missing: ShortTextSchema.default('') }),
  z.object({ kind: z.literal('page'), id: IdSchema, label: ShortTextSchema }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const ReadingDocSchema = z.object({
  title: ShortTextSchema.default(''),
  /** Where the text came from, shown to students (e.g. a citation). */
  attribution: ShortTextSchema.default(''),
  /** The original file as uploaded (asset id), kept for comparison and for students to open. */
  original: z.object({ assetId: IdSchema.nullable(), kind: z.enum(['paste', 'text', 'html', 'docx', 'pdf', 'image']), name: ShortTextSchema }).nullable().default(null),
  blocks: z.array(BlockSchema).max(5000),
  /** Paragraph numbers in the margin. */
  numbering: z.boolean().default(true),
  approval: z.object({ hash: z.string(), approvedAt: z.iso.datetime() }).nullable().default(null),
});
export type ReadingDoc = z.infer<typeof ReadingDocSchema>;

export const runsText = (runs: Run[]) => runs.map((r) => r.text).join('');

/** Hash of exactly what students will see (blocks + numbering + title + attribution). */
export function readingHash(doc: Pick<ReadingDoc, 'blocks' | 'numbering' | 'title' | 'attribution'>): string {
  return `sha256:${sha256HexSync(canonicalJson({ blocks: doc.blocks, numbering: doc.numbering, title: doc.title, attribution: doc.attribution }))}`;
}
export function isApproved(doc: ReadingDoc): boolean {
  return !!doc.approval && doc.approval.hash === readingHash(doc);
}

/** An annotatable piece of text: a paragraph, heading, quote, list item, table cell or caption. */
export interface Unit {
  id: string;
  blockId: string;
  text: string;
  runs: Run[];
  /** Paragraph number (¶) the unit belongs to, if numbered. */
  paragraph: number | null;
}

/** Paragraph numbers: count numbered paragraphs only, in document order. */
export function paragraphNumbers(doc: ReadingDoc): Map<string, number> {
  const out = new Map<string, number>();
  if (!doc.numbering) return out;
  let n = 0;
  for (const b of doc.blocks) if (b.kind === 'paragraph' && b.numbered) out.set(b.id, ++n);
  return out;
}

export function readingUnits(doc: ReadingDoc): Unit[] {
  const nums = paragraphNumbers(doc);
  const units: Unit[] = [];
  let lastPara: number | null = null;
  for (const b of doc.blocks) {
    const push = (id: string, runs: Run[]) => units.push({ id, blockId: b.id, runs, text: runsText(runs), paragraph: lastPara });
    switch (b.kind) {
      case 'paragraph':
        lastPara = nums.get(b.id) ?? lastPara;
        push(b.id, b.runs);
        break;
      case 'heading':
      case 'quote':
        push(b.id, b.runs);
        break;
      case 'list':
        b.items.forEach((it, i) => push(`${b.id}:${i}`, it));
        break;
      case 'table':
        if (b.caption.length) push(`${b.id}:cap`, b.caption);
        b.rows.forEach((row, r) => row.forEach((cell, c) => push(`${b.id}:${r}:${c}`, cell.runs)));
        break;
      case 'figure':
        if (b.caption.length) push(`${b.id}:cap`, b.caption);
        break;
      case 'page':
        break;
    }
  }
  return units;
}

/** Plain text of the whole reading, in order (used for integrity checks and search). */
export function readingPlainText(doc: ReadingDoc): string {
  return readingUnits(doc).map((u) => u.text).join('\n');
}

/** Split runs at the given character offsets (for rendering annotations over formatted text). */
export function sliceRuns(runs: Run[], start: number, end: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + r.text.length);
    if (a < b) out.push({ ...r, text: r.text.slice(a - pos, b - pos) });
    pos += r.text.length;
  }
  return out;
}

/** Plain text → blocks: blank lines separate paragraphs; single line breaks are kept. */
export function blocksFromPlainText(text: string, newId: () => string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '')
    .map((p) => ({ kind: 'paragraph' as const, id: newId(), runs: [{ text: p }], numbered: true }));
}
