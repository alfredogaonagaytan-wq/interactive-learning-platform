import type { Item } from '@ilp/core';

const gapText = (segments: Array<{ kind: string; text?: string }>) => segments.map((s) => (s.kind === 'text' ? s.text : '___')).join('');

/** One-line description of an item for outlines, lists and dialogs. */
export function itemSummary(item: Item): string {
  const cut = (s: string, empty: string) => s.trim().slice(0, 70) || empty;
  switch (item.type) {
    case 'content':
      return cut(item.title || item.body, 'Empty text block');
    case 'fill-blanks':
    case 'drag-words':
    case 'dropdown-cloze':
      return cut(gapText(item.segments) || item.prompt, 'No text yet');
    case 'mark-words':
      return cut(item.prompt || item.text.replace(/\*/g, ''), 'No text yet');
    case 'matching':
      return cut(item.pairs.map((p) => p.left).filter(Boolean).join(', ') || item.prompt, 'No pairs yet');
    case 'sequencing':
      return cut(item.steps.map((s) => s.text).filter(Boolean).join(' → ') || item.prompt, 'No steps yet');
    case 'audio':
      return cut(item.title || item.audio?.transcript || '', item.audio ? 'Audio clip' : 'No audio yet');
    case 'sentence-response':
      return cut(item.source || item.prompt, 'No prompt yet');
    case 'sentence-builder':
      return cut(item.sentence, 'No sentence yet');
    case 'dictation':
      return cut(item.text, 'No text yet');
    case 'speaking':
      return cut(item.targets.map((t) => t.text).filter(Boolean).join(' · '), 'No phrases yet');
    case 'drag-drop':
      return cut(item.prompt || item.zones.map((z) => z.label).join(' / '), 'No zones yet');
    default:
      return cut(item.prompt, 'No question text yet');
  }
}
