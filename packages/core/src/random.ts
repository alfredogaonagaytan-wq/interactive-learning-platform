/** Deterministic PRNG + shuffle seeded by a string (e.g. an attempt id), so a reload shows the same order. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Shuffle that never returns the original order (when more than one distinct element). */
export function seededDerangedShuffle<T>(items: readonly T[], seed: string): T[] {
  if (items.length < 2) return [...items];
  for (let k = 0; k < 20; k++) {
    const out = seededShuffle(items, `${seed}:${k}`);
    if (out.some((x, i) => x !== items[i])) return out;
  }
  return [...items.slice(1), items[0]!];
}
