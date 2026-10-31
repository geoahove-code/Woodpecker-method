// Puzzle catalogue: loads data/puzzles.json once, indexes it and serves queries.
import { getCustomPuzzles } from './storage.js';

export const ECT_THEMES = [
  'annihilation',
  'blockade',
  'clearance',
  'deflection',
  'discoveredAttack',
  'pin',
  'pawnStructure',
  'attraction',
  'interference',
  'doubleAttack',
];

export const LEVELS = ['basic', 'intermediate', 'advanced'];

let cache = null;
let loading = null;

export async function loadPuzzles() {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    const res = await fetch('data/puzzles.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error('puzzles.json: HTTP ' + res.status);
    const list = await res.json();
    const byId = new Map();
    for (const p of list) byId.set(p.id, p);
    for (const p of Object.values(getCustomPuzzles())) {
      if (p && p.tree) byId.set(p.id, p);
    }
    cache = { list, byId };
    return cache;
  })();
  return loading;
}

export function isLoaded() {
  return !!cache;
}

export function getPuzzleById(id) {
  return cache ? cache.byId.get(id) || null : null;
}

export function getPuzzlesByIds(ids) {
  if (!cache) return [];
  return ids.map((id) => cache.byId.get(id)).filter(Boolean);
}

/** Make a freshly imported puzzle available without reloading the corpus. */
export function registerCustomPuzzle(puzzle) {
  if (!cache) cache = { list: [], byId: new Map() };
  cache.byId.set(puzzle.id, puzzle);
  return puzzle;
}

/** Puzzle counts per theme, used by the dashboard. */
export function themeCounts() {
  const counts = Object.fromEntries(ECT_THEMES.map((t) => [t, 0]));
  if (!cache) return counts;
  for (const p of cache.list) counts[p.theme] = (counts[p.theme] || 0) + 1;
  return counts;
}

/**
 * Filter the catalogue.
 * @param {{themes?:string[], levels?:string[], minRating?:number, maxRating?:number}} filter
 */
export function filterPuzzles(filter = {}) {
  if (!cache) return [];
  const themes = filter.themes && filter.themes.length ? new Set(filter.themes) : null;
  const levels = filter.levels && filter.levels.length ? new Set(filter.levels) : null;
  return cache.list.filter((p) => {
    if (themes && !themes.has(p.theme) && !(p.ect || []).some((t) => themes.has(t))) return false;
    if (levels && !levels.has(p.level)) return false;
    if (filter.minRating != null && p.rating < filter.minRating) return false;
    if (filter.maxRating != null && p.rating > filter.maxRating) return false;
    return true;
  });
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `count` puzzles spread over the requested themes and levels.
 * Deterministic for a given seed, so a set can be rebuilt identically.
 */
export function pickPuzzles({ themes, levels, count, seed = Date.now() }) {
  let pool = filterPuzzles({ themes, levels });
  if (!pool.length) pool = filterPuzzles({ levels });
  if (!pool.length && cache) pool = [...cache.list];

  const rand = mulberry32(seed);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // balance: round-robin over (theme, level) buckets
  const buckets = new Map();
  for (const p of shuffled) {
    const key = `${p.theme}|${p.level}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  const keys = [...buckets.keys()];
  const picked = [];
  const seen = new Set();
  let guard = 0;
  while (picked.length < count && guard++ < count * 40) {
    let progressed = false;
    for (const k of keys) {
      if (picked.length >= count) break;
      const bucket = buckets.get(k);
      const next = bucket.shift();
      if (next && !seen.has(next.id)) {
        seen.add(next.id);
        picked.push(next);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  if (picked.length < count) {
    for (const p of shuffled) {
      if (picked.length >= count) break;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      picked.push(p);
    }
  }
  return picked;
}
