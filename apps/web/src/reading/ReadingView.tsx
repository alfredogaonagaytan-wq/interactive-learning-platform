import { Fragment, type ReactNode } from 'react';
import { paragraphNumbers, runsText, sliceRuns, type Annotation, type Block, type ObservationSymbol, type ReadingDoc, type Run } from '@ilp/core';
import { AssetImage } from '../ui/media';

/**
 * Renders a reading exactly as approved. Text is output verbatim (React escapes
 * it; whitespace and line breaks are preserved with CSS). Highlight codes are
 * drawn with CSS ::before content so they never become part of the text, which
 * keeps text selection offsets and copy/paste faithful to the source.
 */
export function RunsView({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = r.text;
        if (r.sup) node = <sup>{node}</sup>;
        if (r.sub) node = <sub>{node}</sub>;
        if (r.u) node = <u>{node}</u>;
        if (r.i) node = <em>{node}</em>;
        if (r.b) node = <strong>{node}</strong>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

interface AnnotationProps {
  annotations: Annotation[];
  symbols: ObservationSymbol[];
  activeId?: string | null;
  onAnnotationClick?: (id: string) => void;
}

/** One annotatable unit: text split at annotation boundaries. */
export function UnitText({ unitId, runs, annotations, symbols, activeId, onAnnotationClick }: { unitId: string; runs: Run[] } & AnnotationProps) {
  const text = runsText(runs);
  const mine = annotations.filter((a) => a.unitId === unitId && a.end <= text.length && text.slice(a.start, a.end) === a.quote);
  if (mine.length === 0) {
    return <span className="unit" data-unit-id={unitId}><RunsView runs={runs} /></span>;
  }
  const cuts = [...new Set([0, text.length, ...mine.flatMap((a) => [a.start, a.end])])].sort((x, y) => x - y);
  const sym = new Map(symbols.map((s) => [s.id, s]));
  const segs: ReactNode[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k]!;
    const b = cuts[k + 1]!;
    const covering = mine.filter((x) => x.start <= a && x.end >= b);
    const part = <RunsView runs={sliceRuns(runs, a, b)} />;
    if (covering.length === 0) {
      segs.push(<Fragment key={k}>{part}</Fragment>);
      continue;
    }
    const top = covering[covering.length - 1]!;
    const s = sym.get(top.symbolId);
    const starts = covering.filter((x) => x.start === a).map((x) => sym.get(x.symbolId)?.code).filter(Boolean).join(' ');
    segs.push(
      <mark
        key={k}
        className={`obs obs-${s?.color ?? 'amber'} ${covering.some((x) => x.id === activeId) ? 'is-active' : ''} ${covering.length > 1 ? 'is-overlap' : ''}`}
        data-code={starts || undefined}
        title={covering.map((x) => `${sym.get(x.symbolId)?.label ?? ''}${x.note ? `: ${x.note}` : ''}`).join(' · ')}
        onClick={() => onAnnotationClick?.(top.id)}
      >
        {part}
      </mark>,
    );
  }
  return <span className="unit" data-unit-id={unitId}>{segs}</span>;
}

export function ReadingView({ doc, promptUnits = new Set(), onPromptClick, ...ann }: { doc: ReadingDoc; promptUnits?: Set<string>; onPromptClick?: (unitId: string) => void } & AnnotationProps) {
  const nums = paragraphNumbers(doc);
  const q = (unitId: string, label: string) =>
    promptUnits.has(unitId) && onPromptClick ? (
      <button type="button" className="prompt-marker" aria-label={`Question about ${label}`} onClick={() => onPromptClick(unitId)}>Q</button>
    ) : null;
  const block = (b: Block): ReactNode => {
    switch (b.kind) {
      case 'heading': {
        const H = (['h2', 'h3', 'h4', 'h5'] as const)[b.level - 1] ?? 'h5';
        return <H key={b.id} className="r-heading">{q(b.id, 'this heading')}<UnitText unitId={b.id} runs={b.runs} {...ann} /></H>;
      }
      case 'paragraph': {
        const n = nums.get(b.id);
        return (
          <div key={b.id} className="r-para" id={`para-${b.id}`}>
            {n !== undefined && <span className="para-num"><span className="sr-only">Paragraph </span>{n}</span>}
            <p>
              <UnitText unitId={b.id} runs={b.runs} {...ann} />
            </p>
            {q(b.id, n !== undefined ? `paragraph ${n}` : 'this paragraph')}
          </div>
        );
      }
      case 'quote':
        return <blockquote key={b.id} className="r-quote"><UnitText unitId={b.id} runs={b.runs} {...ann} />{q(b.id, 'this quotation')}</blockquote>;
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul';
        return <L key={b.id} className="r-list">{b.items.map((it, i) => <li key={i}><UnitText unitId={`${b.id}:${i}`} runs={it} {...ann} />{q(`${b.id}:${i}`, `list item ${i + 1}`)}</li>)}</L>;
      }
      case 'table':
        return (
          <div key={b.id} className="r-table-wrap">
            <table className="r-table">
              {b.caption.length > 0 && <caption><UnitText unitId={`${b.id}:cap`} runs={b.caption} {...ann} /></caption>}
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => {
                      const C = cell.header ? 'th' : 'td';
                      return <C key={c}><UnitText unitId={`${b.id}:${r}:${c}`} runs={cell.runs} {...ann} /></C>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'figure':
        return (
          <figure key={b.id} className="r-figure">
            {b.image ? <AssetImage image={b.image} className="r-img" /> : <span className="asset-missing">{b.missing || 'Image not available'}</span>}
            {b.caption.length > 0 && <figcaption><UnitText unitId={`${b.id}:cap`} runs={b.caption} {...ann} /></figcaption>}
          </figure>
        );
      case 'page':
        return <div key={b.id} className="r-page" role="separator" aria-label={b.label}><span>{b.label}</span></div>;
    }
  };
  return (
    <article className="reading" aria-label={doc.title || 'Reading'}>
      {doc.title && <h2 className="r-title">{doc.title}</h2>}
      {doc.attribution && <p className="r-attrib">{doc.attribution}</p>}
      {doc.blocks.map(block)}
    </article>
  );
}

/** Character offsets of a DOM range inside a unit element (CSS-generated codes are not part of the range text). */
export function rangeOffsets(unitEl: Element, range: Range): { start: number; end: number } | null {
  if (!unitEl.contains(range.startContainer) || !unitEl.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(unitEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}
