// Woodpecker cycle logic: ordering, timing, compression.
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stub so storage.js can run outside the browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { createSet, getCycles, getSession } = await import('../js/storage.js');
const { WoodpeckerSession, buildOrder } = await import('../js/woodpecker.js');

const puzzles = [
  { id: 'p1', theme: 'pin', level: 'basic', rating: 1200 },
  { id: 'p2', theme: 'fork', level: 'basic', rating: 1300 },
  { id: 'p3', theme: 'pin', level: 'advanced', rating: 1900 },
];

test('a cycle records results and computes stats', () => {
  const set = createSet({ name: 'test', puzzleIds: puzzles.map((p) => p.id), themes: [], levels: [] });
  const session = new WoodpeckerSession({ setId: set.id, puzzles, session: null });
  assert.equal(session.cycleIndex, 1);
  assert.equal(session.total, 3);

  session.startCycle();
  session.markPuzzleDone('p1', { solved: true, errors: 0, timeMs: 10_000 });
  session.nextPuzzle();
  session.markPuzzleDone('p2', { solved: false, errors: 1, timeMs: 20_000 });
  session.nextPuzzle();
  session.markPuzzleDone('p3', { solved: true, errors: 0, timeMs: 30_000 });

  const stats = session.getCycleStats();
  assert.equal(stats.solved, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.totalTime, 60_000);

  const outcome = session.completeCycle();
  assert.equal(outcome.compression, null, 'first cycle has no baseline');
  assert.equal(getCycles(set.id).length, 1);
  assert.equal(getSession(), null, 'session is cleared once the cycle is stored');
});

test('failed puzzles get priority in the next cycle', () => {
  const set = createSet({ name: 'test2', puzzleIds: ['p1', 'p2', 'p3'], themes: [], levels: [] });
  const previous = { results: { p1: { solved: true }, p2: { solved: false }, p3: { solved: true } } };
  assert.deepEqual(buildOrder(set.id, ['p1', 'p2', 'p3'], previous), ['p2', 'p1', 'p3']);

  const session = new WoodpeckerSession({ setId: set.id, puzzles, session: null });
  assert.equal(session.cycleIndex, 1);
});

test('compression is measured against the previous cycle', () => {
  const set = createSet({ name: 'test3', puzzleIds: ['p1', 'p2', 'p3'], themes: [], levels: [] });
  const first = new WoodpeckerSession({ setId: set.id, puzzles, session: null });
  first.startCycle();
  for (const p of puzzles) {
    first.markPuzzleDone(p.id, { solved: true, errors: 0, timeMs: 20_000 });
    first.nextPuzzle();
  }
  first.completeCycle();

  const second = new WoodpeckerSession({ setId: set.id, puzzles, session: null });
  assert.equal(second.cycleIndex, 2);
  second.startCycle();
  for (const p of puzzles) {
    second.markPuzzleDone(p.id, { solved: true, errors: 0, timeMs: 10_000 });
    second.nextPuzzle();
  }
  const outcome = second.completeCycle();
  assert.equal(outcome.cycle.index, 2);
  assert.ok(Math.abs(outcome.compression - 0.5) < 1e-9, 'halving the time is a 0.5 compression');
  assert.ok(Math.abs(outcome.improvement - 0.5) < 1e-9);
});

test('a running cycle can be restored', () => {
  const set = createSet({ name: 'test4', puzzleIds: ['p1', 'p2', 'p3'], themes: [], levels: [] });
  const session = new WoodpeckerSession({ setId: set.id, puzzles, session: null });
  session.startCycle();
  session.markPuzzleDone('p1', { solved: true, errors: 0, timeMs: 5_000 });
  session.nextPuzzle();
  session.persist();

  const restored = new WoodpeckerSession({ setId: set.id, puzzles, session: getSession() });
  assert.equal(restored.restored, true);
  assert.equal(restored.index, 1);
  assert.equal(restored.currentPuzzleId, 'p2');
  assert.equal(restored.results.p1.solved, true);
  assert.equal(restored.cycleIndex, session.cycleIndex);
});
