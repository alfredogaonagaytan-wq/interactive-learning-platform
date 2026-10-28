import type { MatchOptions } from '../schema/common';
import { canonicalAnswer } from '../grading/normalize';

/**
 * Teacher-written answer patterns.
 *
 *   She {has|'s} {already |}finished her homework.
 *
 * {a|b|c}  one of the alternatives
 * {a|}     optional (an empty alternative)
 * \{ \} \| literal characters
 *
 * Patterns are expanded into the finite set of sentences they describe, then
 * compared after the same normalisation as typed answers. Expansion keeps
 * grading transparent: a teacher can list exactly which sentences are
 * accepted, and nothing outside that set ever receives credit.
 */
export const MAX_PATTERN_EXPANSIONS = 2000;

type Node = { kind: 'text'; text: string } | { kind: 'choice'; options: Node[][] };

export class PatternError extends Error {}

export function parsePattern(src: string): Node[] {
  let i = 0;
  const parseSeq = (inChoice: boolean): { nodes: Node[]; end: '|' | '}' | 'eof' } => {
    const nodes: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) nodes.push({ kind: 'text', text });
      text = '';
    };
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\' && i + 1 < src.length) {
        text += src[i + 1];
        i += 2;
        continue;
      }
      if (c === '{') {
        flush();
        i++;
        const options: Node[][] = [];
        for (;;) {
          const r = parseSeq(true);
          options.push(r.nodes);
          if (r.end === '}') break;
          if (r.end === 'eof') throw new PatternError('A “{” is never closed with “}”.');
        }
        nodes.push({ kind: 'choice', options });
        continue;
      }
      if (inChoice && (c === '|' || c === '}')) {
        flush();
        i++;
        return { nodes, end: c };
      }
      if (!inChoice && (c === '|' || c === '}')) throw new PatternError(`“${c}” is only allowed inside { }. Use \\${c} for the character itself.`);
      text += c;
      i++;
    }
    flush();
    return { nodes, end: 'eof' };
  };
  return parseSeq(false).nodes;
}

export function expandPattern(src: string, limit = MAX_PATTERN_EXPANSIONS): string[] {
  const expand = (nodes: Node[]): string[] => {
    let acc = [''];
    for (const n of nodes) {
      const parts = n.kind === 'text' ? [n.text] : n.options.flatMap(expand);
      const next: string[] = [];
      for (const a of acc) for (const p of parts) {
        next.push(a + p);
        if (next.length > limit) throw new PatternError(`This pattern allows more than ${limit} sentences. Split it into several simpler patterns.`);
      }
      acc = next;
    }
    return acc;
  };
  return [...new Set(expand(parsePattern(src)).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

/** Precompiled canonical forms for fast, repeatable matching. */
export interface CompiledPatterns {
  forms: Map<string, string>; // canonical -> one readable sentence
}

export function compilePatterns(patterns: readonly string[], options: MatchOptions, language = 'en'): CompiledPatterns {
  const forms = new Map<string, string>();
  for (const p of patterns) {
    if (!p.trim()) continue;
    for (const s of expandPattern(p)) {
      const c = canonicalAnswer(s, options, language);
      if (c && !forms.has(c)) forms.set(c, s);
    }
  }
  return { forms };
}

export function matchesCompiled(answer: string, compiled: CompiledPatterns, options: MatchOptions, language = 'en'): string | null {
  return compiled.forms.get(canonicalAnswer(answer, options, language)) ?? null;
}

/** Validation helper: the first error in any pattern, or null. */
export function patternProblem(patterns: readonly string[]): string | null {
  for (const p of patterns) {
    try {
      expandPattern(p);
    } catch (e) {
      return `${(e as Error).message} (in “${p.slice(0, 60)}”)`;
    }
  }
  return null;
}
