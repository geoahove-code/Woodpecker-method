// Woodpecker method mechanics: a fixed puzzle set, repeated cycles, with the
// goal of halving the time of every cycle while keeping accuracy.
import {
  getCycles,
  saveCycle,
  getSession,
  saveSession,
  clearSession,
  getSet,
} from './storage.js';

export const TARGET_COMPRESSION = 0.5; // "half the time of the previous cycle"

export function cycleCount(setId) {
  return getCycles(setId).length;
}

/**
 * Order of a cycle: puzzles failed in the previous cycle come first
 * (priority review), the rest keep the set order.
 */
export function buildOrder(setId, puzzleIds, previousCycle) {
  if (!previousCycle || !previousCycle.results) return [...puzzleIds];
  const failed = puzzleIds.filter((id) => {
    const res = previousCycle.results[id];
    return res && !res.solved;
  });
  const rest = puzzleIds.filter((id) => !failed.includes(id));
  return [...failed, ...rest];
}

export class WoodpeckerSession {
  /**
   * @param {object} opts
   * @param {string} opts.setId
   * @param {object[]} opts.puzzles resolved puzzle objects, in set order
   * @param {object|null} opts.session restored session state
   */
  constructor({ setId, puzzles, session }) {
    this.setId = setId;
    this.puzzles = puzzles;
    const previous = getCycles(setId);
    this.cycleIndex = previous.length + 1;
    this.meta = {};
    for (const p of puzzles) this.meta[p.id] = { theme: p.theme, level: p.level, rating: p.rating };

    if (session && session.setId === setId) {
      this.cycleIndex = session.cycleIndex;
      this.order = session.order;
      this.results = session.results || {};
      this.index = session.index || 0;
      this.elapsedMs = session.elapsedMs || 0;
      this.resumedAt = Date.now();
      this.startedAt = session.startedAt;
      this.restored = true;
    } else {
      const previousCycle = previous[previous.length - 1] || null;
      this.order = buildOrder(
        setId,
        puzzles.map((p) => p.id),
        previousCycle
      );
      this.results = {};
      this.index = 0;
      this.elapsedMs = 0;
      this.resumedAt = Date.now();
      this.startedAt = Date.now();
      this.restored = false;
    }
    this.puzzleStartedAt = Date.now();
  }

  get previousCycle() {
    const cycles = getCycles(this.setId);
    return cycles.find((c) => c.index === this.cycleIndex - 1) || null;
  }

  get currentPuzzleId() {
    return this.order[this.index] || null;
  }

  get total() {
    return this.order.length;
  }

  get finished() {
    return this.index >= this.total;
  }

  startCycle() {
    this.startedAt = Date.now();
    this.resumedAt = Date.now();
    this.elapsedMs = 0;
    this.index = 0;
    this.results = {};
    this.persist();
  }

  /** Live cycle clock: persisted total + time spent on the current puzzle. */
  cycleElapsedMs() {
    return this.elapsedMs + (Date.now() - this.puzzleStartedAt);
  }

  markPuzzleDone(puzzleId, { solved, errors, timeMs }) {
    this.results[puzzleId] = { solved: !!solved, errors: errors || 0, timeMs: timeMs || 0 };
    this.elapsedMs += timeMs || 0;
    this.puzzleStartedAt = Date.now();
  }

  nextPuzzle() {
    this.index++;
    this.puzzleStartedAt = Date.now();
    this.persist();
    return this.currentPuzzleId;
  }

  getCycleStats() {
    const values = Object.values(this.results);
    const solved = values.filter((r) => r.solved).length;
    const failed = values.length - solved;
    const totalTime = values.reduce((sum, r) => sum + (r.timeMs || 0), 0);
    return {
      solved,
      failed,
      done: values.length,
      total: this.total,
      totalTime,
      avgTime: values.length ? totalTime / values.length : 0,
    };
  }

  /** Close the cycle and store it; returns the completed cycle record. */
  completeCycle() {
    const stats = this.getCycleStats();
    const previous = this.previousCycle;
    const totalTimeMs = stats.totalTime;
    const compression = previous && previous.totalTimeMs ? totalTimeMs / previous.totalTimeMs : null;
    const cycle = {
      index: this.cycleIndex,
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      totalTimeMs,
      order: this.order,
      results: this.results,
      meta: this.meta,
      solved: stats.solved,
      failed: stats.failed,
    };
    saveCycle(this.setId, cycle);
    clearSession();
    return {
      cycle,
      compression,
      improvement: compression != null ? 1 - compression : null,
      previous,
      failedIds: Object.entries(this.results)
        .filter(([, r]) => !r.solved)
        .map(([id]) => id),
    };
  }

  persist() {
    saveSession({
      setId: this.setId,
      cycleIndex: this.cycleIndex,
      order: this.order,
      results: this.results,
      index: this.index,
      elapsedMs: this.elapsedMs,
      startedAt: this.startedAt,
    });
  }

  static load() {
    return getSession();
  }

  static clear() {
    clearSession();
  }
}

export function activeSessionSummary() {
  const session = getSession();
  if (!session) return null;
  const set = getSet(session.setId);
  if (!set) {
    clearSession();
    return null;
  }
  return {
    session,
    set,
    remaining: session.order.length - session.index,
    total: session.order.length,
  };
}
