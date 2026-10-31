// Build the multi-variation solution trees with a native Stockfish 16 binary.
//
// For every selected puzzle we start from the position *after* the Lichess setup
// move (player to move) and expand an alternating tree:
//   player node   -> moves accepted as a solution (official Lichess move + engine best)
//   opponent node -> every reply within OPP_MARGIN centipawns of the best defence
//                    (for forced mates: only the most resilient defences)
// The tree is what makes the app require **all** optimal defensive replies.
//
// Resumable: results are appended to /tmp/trees.jsonl, already-done ids are skipped.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Chess } from '../lib/chess.js';

const SF = process.env.SF || '/tmp/sf16';
const DEPTH = Number(process.env.DEPTH || 12);
const MULTIPV = Number(process.env.MULTIPV || 5);
const OPP_MARGIN = Number(process.env.OPP_MARGIN || 200);
const OPP_MAX = Number(process.env.OPP_MAX || 3);
const PLAYER_ALT_CP = Number(process.env.PLAYER_ALT_CP || 25);
const OFFICIAL_CP = Number(process.env.OFFICIAL_CP || 60);
const MAX_NODES = Number(process.env.MAX_NODES || 24);
const ENGINES = Number(process.env.ENGINES || 4);
const LIMIT = Number(process.env.LIMIT || 0);
const OUT = process.env.OUT || '/tmp/trees.jsonl';

class Engine {
  constructor() {
    this.proc = spawn(SF, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = '';
    this.waiters = [];
    this.queue = Promise.resolve();
    this.proc.stdout.on('data', (d) => this.onData(d.toString()));
    this.proc.on('exit', (code) => {
      for (const w of this.waiters.splice(0)) w.reject(new Error('engine exited ' + code));
    });
    this.send('uci');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 32');
    this.send('ucinewgame');
    this.send('isready');
  }
  send(cmd) {
    this.proc.stdin.write(cmd + '\n');
  }
  onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) this.waiters.forEach((w) => w.onLine(line));
    }
  }
  analyse(fen, depth, multipv) {
    // one search at a time per engine
    const run = () => this.search(fen, depth, multipv);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  search(fen, depth, multipv) {
    return new Promise((resolve, reject) => {
      const best = new Map();
      const waiter = {
        onLine: (line) => {
          if (line.startsWith('info ') && line.includes(' pv ')) {
            const m = /multipv (\d+)/.exec(line);
            const d = / depth (\d+)/.exec(line);
            const cp = /score cp (-?\d+)/.exec(line);
            const mate = /score mate (-?\d+)/.exec(line);
            const pv = / pv (\S+)/.exec(line);
            if (!d || !pv) return;
            if (cp && mate) return;
            const slot = m ? +m[1] : 1;
            if (!cp && !mate) return;
            best.set(slot, {
              slot,
              depth: +d[1],
              cp: cp ? +cp[1] : null,
              mate: mate ? +mate[1] : null,
              uci: pv[1],
            });
          } else if (line.startsWith('bestmove')) {
            this.waiters = this.waiters.filter((w) => w !== waiter);
            const arr = [...best.values()]
              .filter((l) => l.depth >= Math.max(4, depth - 2))
              .sort((a, b) => a.slot - b.slot);
            resolve(arr);
          }
        },
        reject,
      };
      this.waiters.push(waiter);
      // NOTE: MultiPV is a UCI *option*, it is not accepted as a `go` parameter.
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      setTimeout(() => {
        if (this.waiters.includes(waiter)) {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          this.send('stop');
          resolve([...best.values()].sort((a, b) => a.slot - b.slot));
        }
      }, 20000).unref?.();
    });
  }
}

// score in centipawns from the side-to-move's point of view (mate mapped to ±10000)
const cpOf = (line) => (line.cp != null ? line.cp : line.mate > 0 ? 100000 - line.mate * 100 : -100000 - line.mate * 100);

function toMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

async function buildPuzzle(engine, puzzle) {
  const line = puzzle.moves.split(' ');
  const chess = new Chess(puzzle.fen);
  const setup = chess.move(toMove(line[0]));
  if (!setup) throw new Error('illegal setup move');
  const rootFen = chess.fen();
  const playerSide = chess.turn();
  let budget = MAX_NODES;

  const expand = async (fen, plyIndex) => {
    if (budget <= 0) return [];
    if (plyIndex >= line.length) return [];
    const playerTurn = plyIndex % 2 === 1;
    const official = line[plyIndex];
    const c = new Chess(fen);
    if (c.isGameOver()) return [];

    const lines = playerTurn ? await engine.analyse(fen, DEPTH, MULTIPV) : await engine.analyse(fen, DEPTH, MULTIPV);
    if (!lines.length) return [];
    const sorted = [...lines].sort((a, b) => cpOf(b) - cpOf(a));
    const best = sorted[0];
    const sideToMove = c.turn();
    const sign = sideToMove === playerSide ? 1 : -1; // score -> player POV

    let picks = [];
    if (playerTurn) {
      picks = [best];
      for (const l of sorted.slice(1)) {
        if (l.uci === official) continue;
        if (best.mate == null && l.mate == null && cpOf(best) - cpOf(l) <= PLAYER_ALT_CP) picks.push(l);
        if (picks.length >= 2) break;
      }
      if (official && !picks.some((p) => p.uci === official)) {
        const off = lines.find((l) => l.uci === official);
        if (off && (best.mate != null || off.mate != null ? true : cpOf(best) - cpOf(off) <= OFFICIAL_CP)) {
          picks.push(off);
        }
      }
    } else {
      // mandatory defences: everything inside the margin, or the longest mate resistance
      if (best.mate != null && best.mate < 0) {
        picks = sorted.filter((l) => l.mate != null && l.mate <= best.mate);
      } else if (best.mate != null && best.mate > 0) {
        picks = [best];
      } else {
        picks = sorted.filter((l) => best.mate == null && l.mate == null && cpOf(l) >= cpOf(best) - OPP_MARGIN);
      }
      const off = lines.find((l) => l.uci === official);
      if (off && !picks.some((p) => p.uci === official)) picks.push(off);
      if (picks.length > OPP_MAX) {
        const keepOfficial = picks.find((p) => p.uci === official);
        picks = picks.filter((p) => p.mate == null).slice(0, OPP_MAX);
        if (keepOfficial && !picks.includes(keepOfficial)) picks[picks.length - 1] = keepOfficial;
      }
    }

    const out = [];
    for (const pick of picks) {
      budget--;
      if (budget < 0) break;
      const cc = new Chess(fen);
      const mv = cc.move(toMove(pick.uci));
      if (!mv) continue;
      const node = {
        m: pick.uci,
        s: mv.san,
        e: pick.mate != null ? null : Math.round(pick.cp * sign),
      };
      if (pick.mate != null) {
        const toPlayer = pick.mate * sign;
        node.mt = toPlayer > 0 ? Math.ceil(toPlayer / 2 + 0.01) : -Math.ceil(-toPlayer / 2 + 0.01);
      }
      if (cc.isGameOver()) {
        node.g = cc.isCheckmate() ? 'mate' : 'draw';
      } else {
        node.k = await expand(cc.fen(), plyIndex + 1);
      }
      out.push(node);
    }
    return out;
  };

  const tree = { fen: rootFen, side: playerSide, k: await expand(rootFen, 1) };
  return { id: puzzle.id, tree };
}

async function main() {
  const selected = JSON.parse(fs.readFileSync('/tmp/selected.json', 'utf8'));
  const done = new Set();
  if (fs.existsSync(OUT)) {
    for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).id);
      } catch {
        /* partial line, ignore */
      }
    }
  }
  let todo = selected.filter((p) => !done.has(p.id));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`selected ${selected.length} | done ${done.size} | todo ${todo.length} | depth ${DEPTH} | engines ${ENGINES}`);

  let i = 0;
  let ok = 0;
  let failed = 0;
  const started = Date.now();
  const workers = Array.from({ length: Math.min(ENGINES, todo.length) }, () => new Engine());

  await Promise.all(
    workers.map(async (engine) => {
      while (i < todo.length) {
        const puzzle = todo[i++];
        try {
          const result = await buildPuzzle(engine, puzzle);
          fs.appendFileSync(OUT, JSON.stringify(result) + '\n');
          ok++;
        } catch (err) {
          failed++;
          fs.appendFileSync(OUT, JSON.stringify({ id: puzzle.id, error: String(err && err.message) }) + '\n');
        }
        if ((ok + failed) % 20 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${ok + failed}/${todo.length} ok=${ok} fail=${failed} ${(el / (ok + failed)).toFixed(2)}s/puzzle`);
        }
      }
    })
  );
  console.log(`done ok=${ok} failed=${failed} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const w of workers) w.proc.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
