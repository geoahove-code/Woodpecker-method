// Behaviour of the multi-variation solver on real corpus puzzles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PuzzleEngine, treeFromLine, countEdges } from '../js/puzzle-engine.js';
import { Chess } from '../lib/chess.js';

const puzzles = JSON.parse(fs.readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
const firstMove = (engine) => {
  const mv = engine.pendingMoves()[0];
  return { from: mv.uci.slice(0, 2), to: mv.uci.slice(2, 4), promotion: mv.uci[4] };
};

/** Puzzle whose first opponent node offers at least two mandatory defences. */
const branching = puzzles.find((p) => {
  const rootKids = p.tree.k || [];
  return rootKids.some((k) => (k.k || []).length > 1 && k.k.every((c) => (c.k || []).length > 0));
});

test('a wrong move is rejected and flags the puzzle as failed', () => {
  const puzzle = puzzles.find((p) => (p.tree.k || []).length > 0);
  const engine = new PuzzleEngine(puzzle);
  const accepted = new Set(engine.acceptedMoves().map((m) => m.uci));
  const wrong = engine.chess
    .moves({ verbose: true })
    .map((m) => m.from + m.to + (m.promotion || ''))
    .find((uci) => !accepted.has(uci));
  assert.ok(wrong, 'position must have an incorrect alternative');
  const result = engine.attempt({ from: wrong.slice(0, 2), to: wrong.slice(2, 4), promotion: wrong[4] });
  assert.equal(result.status, 'wrong');
  assert.equal(engine.errors, 1);
  assert.equal(engine.failed, true);
  assert.equal(engine.path.length, 0, 'the board must not move on a wrong answer');
});

test('the puzzle is solved only once every branch has been played', () => {
  const engine = new PuzzleEngine(branching);
  const total = engine.counts.playerEdges;
  assert.ok(total >= 2, 'fixture must have several player edges');

  const mv = firstMove(engine);
  const played = engine.attempt(mv);
  assert.equal(played.status, 'correct');
  assert.equal(typeof played.san, 'string', 'a correct move must return its SAN for the UI');
  assert.ok(played.san.length >= 2);
  // the engine answers automatically with one mandatory defence
  const auto = engine.pump();
  assert.equal(auto.type, 'auto', 'opponent must reply automatically');
  assert.ok(engine.path.length >= 2);
  assert.ok(engine.progress().played < total, 'one move must not solve a multi-variation puzzle');
  assert.equal(engine.solved, false);
});

test('the engine rewinds to the remaining defensive replies', () => {
  const engine = new PuzzleEngine(branching);
  let rewound = false;
  for (let guard = 0; guard < 300; guard++) {
    if (engine.isPlayerTurn && engine.pendingMoves().length) {
      assert.equal(engine.attempt(firstMove(engine)).status, 'correct');
      continue;
    }
    const action = engine.pump();
    if (action.type === 'rewind') rewound = true;
    if (action.type === 'complete') break;
  }
  assert.ok(rewound, 'the solver must jump to other defensive branches');
  assert.equal(engine.solved, true);
  assert.equal(engine.progress().played, engine.progress().total);
  assert.equal(engine.progress().percent, 100);
});

test('a full tree can be solved for every puzzle of a sample', () => {
  const sample = puzzles.filter((_, i) => i % 137 === 0).slice(0, 25);
  for (const puzzle of sample) {
    const engine = new PuzzleEngine(puzzle);
    for (let guard = 0; guard < 3000; guard++) {
      if (engine.isPlayerTurn && engine.pendingMoves().length) {
        const res = engine.attempt(firstMove(engine));
        assert.equal(res.status, 'correct', `${puzzle.id}: accepted move rejected`);
        continue;
      }
      if (engine.pump().type === 'complete') break;
    }
    assert.equal(engine.solved, true, `${puzzle.id}: not solvable`);
    assert.equal(engine.errors, 0, `${puzzle.id}: unexpected error`);
  }
});

test('countEdges matches the tree size used for progress', () => {
  const puzzle = puzzles[0];
  const counts = countEdges(puzzle.tree);
  const engine = new PuzzleEngine(puzzle);
  assert.deepEqual(engine.progress().total, counts.playerEdges);
  assert.ok(counts.opponentEdges >= 1);
});

test('imported lines build a solvable single-variation tree', () => {
  // Scholar's mate line: white to move, forced mate on f7.
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const line = ['f3f7'];
  const tree = treeFromLine(fen, line);
  assert.equal(tree.fen, fen);
  const engine = new PuzzleEngine({ id: 'import', tree, theme: 'custom', level: 'custom', rating: 0 });
  assert.equal(engine.attempt({ from: 'f3', to: 'f7' }).status, 'correct');
  const action = engine.pump();
  assert.equal(action.type, 'complete');
  assert.equal(engine.solved, true);
  assert.ok(new Chess(fen).move({ from: 'f3', to: 'f7' }).san.includes('#'));
});
