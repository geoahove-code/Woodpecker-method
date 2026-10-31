// localStorage persistence: settings, sets, cycles, per-puzzle results.
// Everything is local to the browser; there is no backend and no account.
const KEY = {
  settings: 'wp.settings',
  sets: 'wp.sets',
  cycles: 'wp.cycles',
  session: 'wp.session',
  customPuzzles: 'wp.customPuzzles',
};

const DEFAULTS = { lang: 'fr', sound: true, activeSetId: null };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('storage write failed', err);
    return false;
  }
}

export const uid = () =>
  's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ------------------------------------------------------------------ settings */

export function getSettings() {
  return { ...DEFAULTS, ...read(KEY.settings, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEY.settings, next);
  return next;
}

/* ---------------------------------------------------------------------- sets */

/**
 * A set: { id, name, createdAt, puzzleIds: string[], themes: string[],
 *          levels: string[], playedCount, lastPlayedAt }
 * Cycles: { [setId]: Cycle[] } where
 *   Cycle = { index, startedAt, finishedAt, totalTimeMs, order: string[],
 *             results: { [puzzleId]: { solved, errors, timeMs, failed } } }
 */
export function getSets() {
  return read(KEY.sets, []);
}

export function getSet(id) {
  return getSets().find((s) => s.id === id) || null;
}

export function saveSet(set) {
  const sets = getSets();
  const i = sets.findIndex((s) => s.id === set.id);
  if (i >= 0) sets[i] = set;
  else sets.push(set);
  write(KEY.sets, sets);
  return set;
}

export function createSet({ name, puzzleIds, themes, levels }) {
  const set = {
    id: uid(),
    name,
    createdAt: Date.now(),
    puzzleIds,
    themes: themes || [],
    levels: levels || [],
  };
  saveSet(set);
  write(KEY.cycles, { ...getCyclesBySet(), [set.id]: [] });
  return set;
}

export function deleteSet(id) {
  write(KEY.sets, getSets().filter((s) => s.id !== id));
  const cycles = getCyclesBySet();
  delete cycles[id];
  write(KEY.cycles, cycles);
  const session = getSession();
  if (session && session.setId === id) clearSession();
}

export function duplicateSet(id) {
  const src = getSet(id);
  if (!src) return null;
  return createSet({
    name: src.name + ' (copie)',
    puzzleIds: [...src.puzzleIds],
    themes: [...(src.themes || [])],
    levels: [...(src.levels || [])],
  });
}

export function addPuzzleToSet(setId, puzzle) {
  const set = getSet(setId);
  if (!set) return false;
  const custom = read(KEY.customPuzzles, {});
  custom[puzzle.id] = puzzle;
  write(KEY.customPuzzles, custom);
  if (!set.puzzleIds.includes(puzzle.id)) {
    set.puzzleIds = [...set.puzzleIds, puzzle.id];
    saveSet(set);
  }
  return true;
}

export function getCustomPuzzles() {
  return read(KEY.customPuzzles, {});
}

/* -------------------------------------------------------------------- cycles */

export function getCyclesBySet() {
  return read(KEY.cycles, {});
}

export function getCycles(setId) {
  return getCyclesBySet()[setId] || [];
}

export function saveCycle(setId, cycle) {
  const all = getCyclesBySet();
  const list = all[setId] || [];
  const i = list.findIndex((c) => c.index === cycle.index);
  if (i >= 0) list[i] = cycle;
  else list.push(cycle);
  all[setId] = list;
  write(KEY.cycles, all);
  return cycle;
}

export function getAllCycles() {
  const all = getCyclesBySet();
  return Object.entries(all).flatMap(([setId, list]) =>
    list.map((c) => ({ ...c, setId, setName: (getSet(setId) || {}).name }))
  );
}

/* ------------------------------------------------------------------- session */
/** Running cycle state, resumable from the dashboard. */
export function getSession() {
  return read(KEY.session, null);
}

export function saveSession(session) {
  write(KEY.session, session);
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY.session);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ helpers */

export function formatDuration(ms, lang = 'fr') {
  if (ms == null || !isFinite(ms)) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDate(ts, lang = 'fr') {
  try {
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Aggregated counters for dashboard and statistics pages. */
export function getGlobalStats() {
  const cycles = getAllCycles();
  const byTheme = {};
  const byThemeLevel = {};
  let solved = 0;
  let failed = 0;
  let timeMs = 0;
  let attempts = 0;
  for (const cycle of cycles) {
    for (const [puzzleId, res] of Object.entries(cycle.results || {})) {
      attempts++;
      timeMs += res.timeMs || 0;
      if (res.solved) solved++;
      else failed++;
      const meta = (cycle.meta && cycle.meta[puzzleId]) || null;
      const theme = meta ? meta.theme : 'unknown';
      const level = meta ? meta.level : 'basic';
      byTheme[theme] = byTheme[theme] || { solved: 0, failed: 0 };
      byTheme[theme][res.solved ? 'solved' : 'failed']++;
      const k = theme + '|' + level;
      byThemeLevel[k] = byThemeLevel[k] || { solved: 0, failed: 0 };
      byThemeLevel[k][res.solved ? 'solved' : 'failed']++;
    }
  }
  return {
    cycles: cycles.length,
    solved,
    failed,
    attempts,
    timeMs,
    accuracy: attempts ? solved / attempts : null,
    byTheme,
    byThemeLevel,
  };
}
