// Multi-variation puzzle solver — the core of the app.
//
// A puzzle carries a pre-computed solution tree (Stockfish 16, 200 cp margin):
//
//   root (player to move, even depth)  -> children = accepted player moves
//   depth 1 (opponent to move)         -> children = mandatory defensive replies
//   depth 2 (player to move)           -> ...
//
// The puzzle is only solved once EVERY player edge of the tree has been played,
// which implies every mandatory defensive reply has been faced.
import { Chess } from '../lib/chess.js';

export const OPPONENT_MARGIN_CP = 200;

const key = (path, move) => path.join('/') + '>' + move;

function toMoveObj(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

/** Count edges of a tree: total player edges must all be played. */
export function countEdges(tree) {
  let playerEdges = 0;
  let opponentEdges = 0;
  let nodes = 0;
  const walk = (node, depth) => {
    nodes++;
    const kids = node.k || [];
    if (depth % 2 === 0) playerEdges += kids.length;
    else opponentEdges += kids.length;
    for (const k of kids) walk(k, depth + 1);
  };
  walk(tree, 0);
  return { playerEdges, opponentEdges, nodes };
}

export class PuzzleEngine {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.tree = puzzle.tree;
    this.rootFen = this.tree.fen;
    this.playerSide = this.tree.side || (this.tree.fen.split(' ')[1] === 'w' ? 'w' : 'b');
    this.played = new Set();
    this.path = [];
    this.chess = new Chess(this.rootFen);
    this.errors = 0;
    this.hinted = false;
    this.lastMove = null;
    this.counts = countEdges(this.tree);
    this.startTime = Date.now();
    this.endTime = null;
  }

  /* ------------------------------------------------------------- state --- */

  get fen() {
    return this.chess.fen();
  }

  /** 'white' | 'black' — Chessground orientation. */
  get orientation() {
    return this.playerSide === 'w' ? 'white' : 'black';
  }

  /** True when the engine waits for the solver. */
  get isPlayerTurn() {
    return this.path.length % 2 === 0;
  }

  get failed() {
    return this.errors > 0 || this.hinted;
  }

  get solved() {
    return this.findPending() === null;
  }

  get durationMs() {
    return (this.endTime || Date.now()) - this.startTime;
  }

  nodeAt(path = this.path) {
    let node = this.tree;
    for (const uci of path) {
      const next = (node.k || []).find((n) => n.m === uci);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /** Accepted moves at the current (player) node, as {uci, san, ...}. */
  acceptedMoves() {
    const node = this.nodeAt();
    if (!node || !this.isPlayerTurn) return [];
    return (node.k || []).map((c) => ({ uci: c.m, san: c.s }));
  }

  /** Accepted moves whose branch is not solved yet. */
  pendingMoves() {
    return this.acceptedMoves().filter((m) => !this.played.has(key(this.path, m.uci)));
  }

  /** Legal moves for the solver, as a Chessground dests map. */
  legalDests() {
    const dests = new Map();
    if (!this.isPlayerTurn) return dests;
    for (const mv of this.chess.moves({ verbose: true })) {
      if (!dests.has(mv.from)) dests.set(mv.from, []);
      dests.get(mv.from).push(mv.to);
    }
    return dests;
  }

  /** Does this move need a promotion choice? */
  promotionOptions(from, to) {
    const moves = this.chess
      .moves({ verbose: true })
      .filter((m) => m.from === from && m.to === to && m.promotion);
    return moves.map((m) => m.promotion);
  }

  /* ------------------------------------------------------------ moves --- */

  /**
   * Try a solver move.
   * @returns {{status:'correct'|'wrong'|'illegal'|'notplayer', san?:string}}
   */
  attempt({ from, to, promotion }) {
    if (!this.isPlayerTurn) return { status: 'notplayer' };
    const moves = this.chess.moves({ verbose: true });
    const legal = moves.find((m) => m.from === from && m.to === to && (promotion ? m.promotion === promotion : true));
    if (!legal) return { status: 'illegal' };

    const edge = key(this.path, legal.from + legal.to + (legal.promotion || ''));
    const accepted = ((this.nodeAt() || {}).k || []).find(
      (c) => c.m === legal.from + legal.to + (legal.promotion || '')
    );
    if (!accepted) {
      this.errors++;
      return { status: 'wrong', san: legal.san };
    }

    // The move is right but this branch is already covered: do not replay it.
    if (this.played.has(edge)) {
      return { status: 'correct', already: true, san: accepted.s, uci: accepted.m };
    }

    this.chess.move({ from, to, promotion });
    this.path.push(accepted.m);
    this.played.add(edge);
    this.lastMove = [from, to];
    return { status: 'correct', san: accepted.s, uci: accepted.m };
  }

  /**
   * Next automatic action:
   *  - {type:'auto', move}      opponent reply to play (animated by the UI)
   *  - {type:'player'}          waiting for the solver
   *  - {type:'rewind', path}    jump to another pending branch
   *  - {type:'complete'}        every variation covered
   */
  pump() {
    const node = this.nodeAt();
    if (!node) return { type: 'complete' };
    const depth = this.path.length;
    if (depth % 2 === 1) {
      const reply = (node.k || []).find((c) => !this.played.has(key(this.path, c.m)));
      if (reply) {
        this.played.add(key(this.path, reply.m));
        const mv = toMoveObj(reply.m);
        this.chess.move(mv);
        this.path.push(reply.m);
        this.lastMove = [mv.from, mv.to];
        return { type: 'auto', move: reply, uci: reply.m };
      }
      return this.rewindOrComplete();
    }
    const pending = (node.k || []).filter((c) => !this.played.has(key(this.path, c.m)));
    if (pending.length) return { type: 'player', pending: pending.map((p) => p.s) };
    return this.rewindOrComplete();
  }

  rewindOrComplete() {
    const next = this.findPending();
    if (!next) {
      this.endTime = this.endTime || Date.now();
      return { type: 'complete' };
    }
    // jumping to another branch means traversing the defensive replies on the way
    for (let i = 1; i < next.path.length; i += 2) {
      this.played.add(key(next.path.slice(0, i), next.path[i]));
    }
    this.navigate(next.path);
    return { type: 'rewind', path: next.path };
  }

  /**
   * Depth-first search for the next player node with an unplayed move.
   * Pure: it never mutates the played set, so it can be used by `solved`.
   */
  findPending() {
    const search = (path, node) => {
      const kids = node.k || [];
      if (path.length % 2 === 0 && kids.some((c) => !this.played.has(key(path, c.m)))) {
        return { path: [...path] };
      }
      for (const child of kids) {
        const found = search([...path, child.m], child);
        if (found) return found;
      }
      return null;
    };
    return search([], this.tree);
  }

  navigate(path) {
    const chess = new Chess(this.rootFen);
    let last = null;
    for (const uci of path) {
      const mv = toMoveObj(uci);
      const done = chess.move(mv);
      if (!done) break;
      last = [mv.from, mv.to];
    }
    this.chess = chess;
    this.path = [...path];
    this.lastMove = last;
  }

  /* ---------------------------------------------------------- progress --- */

  progress() {
    let playedPlayer = 0;
    const walk = (node, path) => {
      const kids = node.k || [];
      if (path.length % 2 === 0) {
        for (const c of kids) {
          if (this.played.has(key(path, c.m))) playedPlayer++;
        }
      }
      for (const c of kids) walk(c, [...path, c.m]);
    };
    walk(this.tree, []);
    const total = this.counts.playerEdges;
    return { played: playedPlayer, total, percent: total ? Math.round((playedPlayer / total) * 100) : 0 };
  }

  /** Structured state of the whole tree for the side panel. */
  treeState() {
    const build = (node, path) => {
      const kids = node.k || [];
      return kids.map((child) => {
        const childPath = [...path, child.m];
        const edge = key(path, child.m);
        const isPlayerEdge = path.length % 2 === 0;
        return {
          uci: child.m,
          san: child.s,
          side: isPlayerEdge ? 'player' : 'opponent',
          state: this.played.has(edge) ? 'solved' : 'pending',
          eval: child.e,
          mate: child.mt,
          gameOver: child.g || null,
          children: build(child, childPath),
        };
      });
    };
    return build(this.tree, []);
  }
}

/**
 * Build a single-line tree from a PGN/FEN import so it can be solved with the
 * same engine. The imported moves become the reference solution.
 */
export function treeFromLine(fen, uciMoves) {
  const chess = new Chess(fen);
  const side = chess.turn();
  const root = { fen, side, k: [] };
  let cursor = root;
  for (const uci of uciMoves) {
    const mv = chess.move(toMoveObj(uci));
    if (!mv) break;
    const node = { m: uci, s: mv.san };
    if (chess.isGameOver()) node.g = chess.isCheckmate() ? 'mate' : 'draw';
    cursor.k = [node];
    cursor = node;
  }
  return root;
}
