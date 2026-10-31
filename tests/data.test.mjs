// Structural validation of the shipped puzzle corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from '../lib/chess.js';

const puzzles = JSON.parse(fs.readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });

function walk(tree, visit) {
  const visitNode = (node, prefix) => {
    visit(node, prefix);
    for (const child of node.k || []) visitNode(child, [...prefix, child.m]);
  };
  for (const child of tree.k || []) visitNode(child, [child.m]);
}

test('corpus size and metadata', () => {
  assert.ok(puzzles.length > 2500, `unexpected corpus size ${puzzles.length}`);
  for (const p of puzzles) {
    assert.match(p.id, /^[A-Za-z0-9]+$/, 'id');
    assert.ok(p.rating >= 700 && p.rating <= 2400, 'rating in range');
    assert.ok(['basic', 'intermediate', 'advanced'].includes(p.level), 'level');
    assert.ok(p.ect.length >= 1, 'at least one ECT theme');
    assert.ok(p.tree && p.tree.fen, 'tree with root fen');
    assert.ok((p.tree.k || []).length >= 1, 'root has a player move');
  }
});

test('every tree edge is legal', () => {
  for (const p of puzzles) {
    const root = new Chess(p.tree.fen);
    walk(p.tree, (node, prefix) => {
      const chess = new Chess(root.fen());
      for (let i = 0; i < prefix.length - 1; i++) {
        assert.ok(chess.move(toMove(prefix[i])), `${p.id}: illegal path ${prefix.slice(0, i + 1)}`);
      }
      assert.ok(chess.move(toMove(node.m)), `${p.id}: illegal move ${node.m}`);
    });
  }
});

test('the official Lichess solution is part of every tree', () => {
  let checked = 0;
  for (const p of puzzles) {
    if (!p.line) continue;
    let cursor = p.tree.k || [];
    let found = true;
    for (const move of p.line.split(' ')) {
      const node = cursor.find((n) => n.m === move);
      if (!node) {
        found = false;
        break;
      }
      cursor = node.k || [];
    }
    assert.ok(found, `${p.id}: official solution missing`);
    checked++;
  }
  assert.ok(checked > 2500);
});

test('the corpus really contains multi-variation puzzles', () => {
  let multi = 0;
  for (const p of puzzles) {
    let hasBranch = false;
    walk(p.tree, (node, prefix) => {
      // odd depth = opponent position: its children are the mandatory defences
      if (prefix.length % 2 === 1 && (node.k || []).length > 1) hasBranch = true;
    });
    if (hasBranch) multi++;
  }
  const ratio = multi / puzzles.length;
  assert.ok(ratio > 0.5, `expected most puzzles to branch, got ${(ratio * 100).toFixed(1)}%`);
});
