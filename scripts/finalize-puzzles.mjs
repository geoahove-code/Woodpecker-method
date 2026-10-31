// Sanity-check the generated trees, then merge them with the puzzle metadata
// into data/puzzles.json (the file the app loads).
import fs from 'node:fs';
import { Chess } from '../lib/chess.js';

const selected = JSON.parse(fs.readFileSync('/tmp/selected.json', 'utf8'));
const trees = new Map();
for (const line of fs.readFileSync('/tmp/trees.jsonl', 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line);
  if (rec.tree) trees.set(rec.id, rec.tree);
}

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });

function walk(tree, cb) {
  const root = new Chess(tree.fen);
  const visit = (node, prefix) => {
    cb(node, prefix, root);
    for (const child of node.k || []) visit(child, [...prefix, child.m]);
  };
  for (const node of tree.k || []) visit(node, [node.m]);
}

const problems = [];
const out = [];
let playerNodeEdges = 0;
let oppBranchCount = 0;
let multiOppPuzzles = 0;
const depthHist = {};

for (const p of selected) {
  const tree = trees.get(p.id);
  if (!tree) continue;
  const line = p.moves.split(' ');
  const root = new Chess(tree.fen);
  let ok = true;
  const fail = (msg) => {
    problems.push(`${p.id}: ${msg}`);
    ok = false;
  };

  // 1. every edge of the tree must be legal in its position
  walk(tree, (node, prefix, rootPos) => {
    const c = new Chess(rootPos.fen());
    for (let i = 0; i < prefix.length - 1; i++) {
      if (!c.move(toMove(prefix[i]))) fail(`illegal path ${prefix.slice(0, i + 1).join(' ')}`);
    }
    if (!c.move(toMove(node.m))) fail(`illegal move ${node.m}`);
  });

  // 2. the official Lichess solution must be a path of the tree
  const official = line.slice(1);
  let cursor = tree.k || [];
  let officialInTree = true;
  for (const mv of official) {
    const node = cursor.find((n) => n.m === mv);
    if (!node) {
      officialInTree = false;
      break;
    }
    cursor = node.k || [];
  }
  if (!officialInTree) fail('official solution missing from tree');

  // 3. statistics (node at depth d is a position; even depths are player positions)
  const stats = { plies: 0, playerEdges: 0, oppEdges: 0, maxOppBranch: 0, nodes: 0 };
  const count = (node, depth) => {
    stats.nodes++;
    const kids = node.k || [];
    if (depth % 2 === 0) {
      stats.playerEdges += kids.length;
    } else {
      stats.oppEdges += kids.length;
      stats.maxOppBranch = Math.max(stats.maxOppBranch, kids.length);
    }
    for (const k of kids) count(k, depth + 1);
  };
  count(tree, 0);
  playerNodeEdges += stats.playerEdges;
  oppBranchCount += stats.oppEdges;
  if (stats.maxOppBranch > 1) multiOppPuzzles++;
  depthHist[stats.playerEdges] = (depthHist[stats.playerEdges] || 0) + 1;
  if (stats.playerEdges === 0) fail('no player edge');

  if (ok) {
    out.push({
      id: p.id,
      fen: p.fen,
      setup: line[0],
      line: official.join(' '),
      rating: p.rating,
      level: p.level,
      theme: p.primaryTheme,
      ect: p.ect,
      lichess: p.lichess,
      tree,
    });
  }
}

fs.writeFileSync('data/puzzles.json', JSON.stringify(out));
const bytes = fs.statSync('data/puzzles.json').size;
console.log(`kept ${out.length}/${selected.length} | size ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`player edges ${playerNodeEdges} | avg branches at opponent nodes ${(oppBranchCount / out.length).toFixed(2)}`);
console.log(`puzzles with >=2 mandatory defensive replies: ${multiOppPuzzles} (${((multiOppPuzzles / out.length) * 100).toFixed(1)}%)`);
console.log('player edges per puzzle:', depthHist);
if (problems.length) {
  console.log(`\n${problems.length} problems:`);
  console.log(problems.slice(0, 25).join('\n'));
} else {
  console.log('no structural problem found');
}
