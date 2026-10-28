import { describe, expect, it } from 'vitest';
import { parseBlankMarkup, serializeBlankMarkup } from '../src';

let n = 0;
const newId = () => `blk_${n++}`;

describe('blank markup', () => {
  it('parses blanks with alternatives', () => {
    n = 0;
    const segs = parseBlankMarkup('She [went | was going] to [school].', [], newId);
    expect(segs).toEqual([
      { kind: 'text', text: 'She ' },
      { kind: 'blank', id: 'blk_0', answers: ['went', 'was going'] },
      { kind: 'text', text: ' to ' },
      { kind: 'blank', id: 'blk_1', answers: ['school'] },
      { kind: 'text', text: '.' },
    ]);
  });
  it('round-trips, including escaped brackets', () => {
    n = 0;
    const src = 'Use \\[sic\\] for [errors | mistakes].';
    const segs = parseBlankMarkup(src, [], newId);
    expect(segs[0]).toEqual({ kind: 'text', text: 'Use [sic] for ' });
    expect(serializeBlankMarkup(segs)).toBe(src);
  });
  it('keeps blank ids and hints when the teacher edits the text', () => {
    n = 0;
    const first = parseBlankMarkup('A [b] c', [], newId);
    (first[1] as { hint?: string }).hint = 'a letter';
    const second = parseBlankMarkup('A long [bee] c', first, newId);
    expect(second[1]).toEqual({ kind: 'blank', id: 'blk_0', answers: ['bee'], hint: 'a letter' });
  });
  it('treats unclosed or empty brackets as text', () => {
    expect(parseBlankMarkup('a [b', [], newId)).toEqual([{ kind: 'text', text: 'a [b' }]);
    expect(parseBlankMarkup('a [ ] b', [], newId)).toEqual([{ kind: 'text', text: 'a [ ] b' }]);
  });
});
