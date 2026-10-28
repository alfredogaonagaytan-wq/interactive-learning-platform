import type { MatchOptions } from '../schema/common';

/**
 * Deterministic text normalisation for answer matching.
 *
 * Always applied (never meaningful for grading):
 *  - Unicode NFC normalisation
 *  - typographic quotes/apostrophes -> straight ASCII
 *  - leading/trailing/repeated whitespace (including non-breaking spaces)
 *
 * Applied only when the teacher allows it (see MatchOptions):
 *  - case folding
 *  - punctuation removal (apostrophes are removed so "don't" == "dont";
 *    other punctuation becomes a space so "well-known" == "well known")
 *  - accent/diacritic removal
 */
export function normalizeAnswer(input: string, options: MatchOptions, language = 'en'): string {
  let s = input.normalize('NFC');
  s = s.replace(/[‘’‚‛′ʼ]/g, "'").replace(/[“”„‟″]/g, '"');
  s = s.replace(/[‐‑‒–—−]/g, '-');
  if (!options.caseSensitive) s = s.toLocaleLowerCase(language);
  if (!options.accentSensitive) s = s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  if (!options.punctuationSensitive) s = s.replace(/'/g, '').replace(/[\p{P}\p{S}]/gu, ' ');
  return s.replace(/\s+/gu, ' ').trim();
}

/**
 * Replace every teacher-defined equivalent phrase with the first phrase of its
 * group, on whole-word boundaries, after normalisation. Longer phrases are
 * replaced first so "do not" wins over "do".
 */
export function applyEquivalences(normalized: string, options: MatchOptions, language = 'en'): string {
  if (options.equivalences.length === 0) return normalized;
  const rules: Array<{ from: string; to: string }> = [];
  for (const group of options.equivalences) {
    const forms = group.map((g) => normalizeAnswer(g, options, language)).filter(Boolean);
    const canonical = forms[0];
    if (canonical === undefined) continue;
    for (const form of forms.slice(1)) if (form !== canonical) rules.push({ from: form, to: canonical });
  }
  rules.sort((a, b) => b.from.length - a.from.length);
  let out = normalized;
  for (const { from, to } of rules) {
    out = out.replace(new RegExp(`(?<=^| )${escapeRegExp(from)}(?= |$)`, 'gu'), to);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function canonicalAnswer(input: string, options: MatchOptions, language = 'en'): string {
  return applyEquivalences(normalizeAnswer(input, options, language), options, language);
}

export type MismatchReason = 'capitalization' | 'punctuation' | 'accents' | 'no-match' | 'blank';

export interface MatchResult {
  matched: boolean;
  /** The accepted answer that matched, if any. */
  matchedAnswer?: string;
  /** When not matched: the most specific reason we can determine deterministically. */
  reason?: MismatchReason;
}

/**
 * Compare a student's answer against all accepted answers.
 * If it fails, re-test with each strict option relaxed to explain *why*
 * (e.g. "only capitalisation differs") without ever awarding credit for it.
 */
export function matchAnswer(given: string, accepted: readonly string[], options: MatchOptions, language = 'en'): MatchResult {
  if (given.trim() === '') return { matched: false, reason: 'blank' };
  const g = canonicalAnswer(given, options, language);
  for (const a of accepted) {
    if (a.trim() !== '' && canonicalAnswer(a, options, language) === g) return { matched: true, matchedAnswer: a };
  }
  const probes: Array<[keyof MatchOptions, MismatchReason]> = [
    ['caseSensitive', 'capitalization'],
    ['punctuationSensitive', 'punctuation'],
    ['accentSensitive', 'accents'],
  ];
  for (const [key, reason] of probes) {
    if (!options[key]) continue;
    const relaxed: MatchOptions = { ...options, [key]: false };
    const rg = canonicalAnswer(given, relaxed, language);
    if (accepted.some((a) => a.trim() !== '' && canonicalAnswer(a, relaxed, language) === rg)) {
      return { matched: false, reason };
    }
  }
  return { matched: false, reason: 'no-match' };
}

export const MISMATCH_MESSAGES: Record<MismatchReason, string> = {
  capitalization: 'Almost — check your capitalization.',
  punctuation: 'Almost — check your punctuation.',
  accents: 'Almost — check your accents or special characters.',
  'no-match': 'This answer does not match an accepted answer.',
  blank: 'No answer was given.',
};
