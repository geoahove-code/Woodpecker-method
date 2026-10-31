// Training page controller: board, timers, multi-variation solving, cycle flow.
import { $, sleep, initShell, toast, openModal, goTo, onLangChange, el } from './app.js';
import { t, applyTranslations, themeName, levelName, getLang } from './i18n.js';
import { loadPuzzles, getPuzzlesByIds, getPuzzleById } from './puzzle-db.js';
import { getSettings, saveSettings, getSet, formatClock, formatDuration } from './storage.js';
import { PuzzleEngine } from './puzzle-engine.js';
import { Board } from './board.js';
import { WoodpeckerSession } from './woodpecker.js';
import { sound } from './sound.js';

const AUTO_ADVANCE_MS = 2600;

let session = null;
let set = null;
let puzzle = null;
let engine = null;
let board = null;
let tickHandle = null;
let puzzleStartedAt = Date.now();
let busy = false;
let cycleOver = false;

/* -------------------------------------------------------------------- setup */

function querySetId() {
  const params = new URLSearchParams(location.search);
  return params.get('set') || getSettings().activeSetId || null;
}

async function boot() {
  initShell();
  applyTranslations(document);
  const setId = querySetId();
  set = setId ? getSet(setId) : null;
  if (!set) {
    openModal('empty-modal');
    wireStaticControls();
    return;
  }
  saveSettings({ activeSetId: set.id });

  await loadPuzzles();
  const puzzles = getPuzzlesByIds(set.puzzleIds);
  if (!puzzles.length) {
    openModal('empty-modal');
    wireStaticControls();
    return;
  }

  session = new WoodpeckerSession({ setId: set.id, puzzles, session: WoodpeckerSession.load() });

  board = new Board($('#board'), { onMove: handleMove });
  wireStaticControls();
  loadCurrentPuzzle();
  startClock();
  window.addEventListener('beforeunload', () => persist());
}

function wireStaticControls() {
  $('#btn-retry')?.addEventListener('click', () => restartPuzzle());
  $('#btn-flip')?.addEventListener('click', () => board?.flip());
  $('#btn-solution')?.addEventListener('click', () => revealSolution());
  $('#btn-next')?.addEventListener('click', () => advance());
  $('#btn-finish')?.addEventListener('click', () => {
    if (cycleOver) return;
    if (confirm(t('train.finishCycle') + ' ?')) finishCycle();
  });
  $('#btn-quit')?.addEventListener('click', () => {
    persist();
    goTo('index.html');
  });
  $('#tree-toggle')?.addEventListener('click', (e) => {
    const body = $('#tree-body');
    const expanded = e.currentTarget.getAttribute('aria-expanded') !== 'false';
    e.currentTarget.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    if (body) body.hidden = expanded;
  });
  $('#new-cycle')?.addEventListener('click', () => {
    // next cycle starts from a fresh session (the modal link reloads the page)
    persist();
  });
  onLangChange(() => {
    applyTranslations(document);
    renderAll();
  });
}

/* ------------------------------------------------------------------ puzzles */

function loadCurrentPuzzle() {
  const id = session.currentPuzzleId;
  if (!id) {
    finishCycle();
    return;
  }
  puzzle = getPuzzleById(id);
  if (!puzzle) {
    toast('puzzle ' + id + ' introuvable', 'error');
    session.nextPuzzle();
    loadCurrentPuzzle();
    return;
  }
  engine = new PuzzleEngine(puzzle);
  puzzleStartedAt = Date.now();
  cycleOver = false;
  busy = false;
  $('#btn-next').hidden = true;
  $('#board-banner').hidden = true;
  board.setOrientation(engine.orientation);
  board.clearArrows();
  setStatus(t('train.playerTurn'));
  renderAll();
}

function persist() {
  if (session) session.persist();
}

function puzzleSolvedCleanly() {
  return engine && engine.solved && engine.errors === 0 && !engine.hinted;
}

/* -------------------------------------------------------------------- board */

function handleMove(from, to) {
  if (!engine || busy || cycleOver) return;
  const promotions = engine.promotionOptions(from, to);
  if (promotions.length > 1) {
    openPromotion(from, to, promotions);
    return;
  }
  attemptMove(from, to, promotions[0]);
}

function attemptMove(from, to, promotion) {
  const result = engine.attempt({ from, to, promotion });
  if (result.status === 'illegal' || result.status === 'notplayer') {
    renderBoard();
    return;
  }
  if (result.status === 'wrong') {
    sound.error();
    board.pulse('wrong');
    setStatus(t('train.wrong'), 'is-error');
    renderAll();
    return;
  }
  if (result.already) {
    setStatus(t('train.already'));
    renderAll();
    return;
  }
  // correct
  const isCapture = result.san.includes('x');
  (isCapture ? sound.capture : sound.move)();
  board.pulse('correct');
  renderAll();
  setStatus(t('train.correct') + ' — ' + result.san, 'is-ok');
  runPump();
}

async function runPump() {
  if (busy) return;
  busy = true;
  let guard = 0;
  while (guard++ < 200) {
    const action = engine.pump();
    if (action.type === 'player') {
      busy = false;
      renderAll();
      return;
    }
    if (action.type === 'auto') {
      renderAll();
      board.pulse('opponent');
      sound.opponent();
      await sleep(430);
      continue;
    }
    if (action.type === 'rewind') {
      renderAll();
      setStatus(t('train.partial'));
      await sleep(260);
      continue;
    }
    if (action.type === 'complete') {
      busy = false;
      renderAll();
      if (!cycleOver) onPuzzleSolved();
      return;
    }
  }
  busy = false;
}

function openPromotion(from, to, promotions) {
  const overlay = $('#promo');
  const choices = $('#promo-choices');
  const fen = engine.fen;
  const color = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  choices.replaceChildren();
  for (const piece of promotions) {
    const btn = el('button', { class: 'promo-choice', type: 'button', title: piece });
    btn.innerHTML = `<span class="cg-wrap"><piece class="${piece} ${color}"></piece></span>`;
    btn.addEventListener('click', () => {
      overlay.hidden = true;
      attemptMove(from, to, piece);
    });
    choices.appendChild(btn);
  }
  overlay.hidden = false;
  renderBoard();
}

/* ------------------------------------------------------------------ solving */

function onPuzzleSolved() {
  const clean = puzzleSolvedCleanly();
  $('#board-banner').hidden = false;
  $('#board-banner').textContent = t('train.complete');
  setStatus(t('train.complete'), 'is-ok');
  (clean ? sound.success : sound.error)();
  session.markPuzzleDone(puzzle.id, {
    solved: clean,
    errors: engine.errors,
    timeMs: Date.now() - puzzleStartedAt,
  });
  session.persist();
  $('#btn-next').hidden = false;
  if (session.index + 1 >= session.total) {
    $('#btn-next').textContent = t('train.finishCycle');
  } else {
    $('#btn-next').textContent = t('train.next');
  }
  setTimeout(() => {
    if (!cycleOver && engine && engine.solved) advance();
  }, AUTO_ADVANCE_MS);
}

function restartPuzzle() {
  if (!puzzle) return;
  engine = new PuzzleEngine(puzzle);
  board.clearArrows();
  $('#btn-next').hidden = true;
  $('#board-banner').hidden = true;
  puzzleStartedAt = Date.now();
  setStatus(t('train.playerTurn'));
  renderAll();
}

/** Reveal every pending branch, then count the puzzle as failed. */
async function revealSolution() {
  if (!engine || cycleOver || busy || engine.solved) return;
  busy = true;
  engine.hinted = true;
  const pendingBefore = engine.findPending();
  if (pendingBefore) {
    const node = engine.nodeAt();
    const first = node && (node.k || [])[0];
    if (first) board.arrows([{ orig: first.m.slice(0, 2), dest: first.m.slice(2, 4), brush: 'green' }]);
  }
  setStatus(t('train.failed'), 'is-hint');
  renderAll();

  let guard = 0;
  while (guard++ < 40) {
    const pending = engine.findPending();
    if (!pending) break;
    if (pending.path.length) {
      engine.navigate(pending.path);
      renderAll();
      await sleep(240);
    }
    const pendingMoves = engine.pendingMoves();
    const nextMove = pendingMoves[0];
    if (!nextMove) break;
    const res = engine.attempt({
      from: nextMove.uci.slice(0, 2),
      to: nextMove.uci.slice(2, 4),
      promotion: nextMove.uci[4],
    });
    if (res.status !== 'correct' || res.already) break;
    renderAll();
    await sleep(380);
    let inner = 0;
    while (inner++ < 20) {
      const action = engine.pump();
      if (action.type === 'player') break;
      if (action.type === 'auto') {
        renderAll();
        await sleep(380);
        continue;
      }
      if (action.type === 'rewind') {
        renderAll();
        break;
      }
      if (action.type === 'complete') break;
    }
  }
  board.clearArrows();
  busy = false;
  if (engine.solved) {
    onPuzzleSolved();
  } else {
    $('#btn-next').hidden = false;
    $('#btn-next').textContent = session.index + 1 >= session.total ? t('train.finishCycle') : t('train.next');
    setStatus(t('train.failed'), 'is-error');
    session.markPuzzleDone(puzzle.id, { solved: false, errors: engine.errors, timeMs: Date.now() - puzzleStartedAt });
    session.persist();
  }
}

function advance() {
  if (cycleOver) return;
  // make sure the finished puzzle is recorded (also when auto-advancing)
  if (puzzle && !session.results[puzzle.id]) {
    session.markPuzzleDone(puzzle.id, {
      solved: puzzleSolvedCleanly(),
      errors: engine ? engine.errors : 0,
      timeMs: Date.now() - puzzleStartedAt,
    });
  }
  const nextId = session.nextPuzzle();
  if (!nextId || session.finished) {
    finishCycle();
    return;
  }
  loadCurrentPuzzle();
}

function finishCycle() {
  if (cycleOver) return;
  cycleOver = true;
  stopClock();
  const outcome = session.completeCycle();
  sound.cycleComplete();
  const summary = $('#cycle-summary');
  const compression =
    outcome.compression == null
      ? '—'
      : `${Math.round((1 - outcome.compression) * 100)}% (${t('stats.vsPrevious')})`;
  summary.textContent =
    t('train.cycleSubtitle', {
      solved: outcome.cycle.solved,
      failed: outcome.cycle.failed,
      total: session.total,
    }) +
    ' ' +
    t('train.cycleDoneText', { time: formatDuration(outcome.cycle.totalTimeMs, getLang()), comp: compression }) +
    (outcome.failedIds.length ? ' ' + t('train.priorityHint', { n: outcome.failedIds.length }) : '');
  openModal('cycle-modal');
}

/* -------------------------------------------------------------------- clock */

function startClock() {
  stopClock();
  tickHandle = setInterval(renderClocks, 500);
  renderClocks();
}

function stopClock() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

function renderClocks() {
  if (!session) return;
  const cycle = $('#cycle-clock');
  const puz = $('#puzzle-clock');
  if (cycle) cycle.textContent = formatClock(session.cycleElapsedMs());
  if (puz) puz.textContent = formatClock(Date.now() - puzzleStartedAt);
}

/* ------------------------------------------------------------------ render */

function setStatus(text, tone = '') {
  const node = $('#status-line');
  if (!node) return;
  node.textContent = text;
  node.className = 'status-line ' + tone;
}

function renderBoard() {
  if (!engine || !board) return;
  const turnPlayer = engine.isPlayerTurn;
  board.set({
    fen: engine.fen,
    dests: turnPlayer ? engine.legalDests() : new Map(),
    lastMove: engine.lastMove,
    playerTurn: turnPlayer,
    check: engine.chess.isCheck(),
  });
}

function renderMeta() {
  $('#set-name').textContent = set.name;
  $('#puzzle-counter').textContent = t('train.puzzleOf', {
    i: Math.min(session.index + 1, session.total),
    n: session.total,
  });
  $('#theme-badge').textContent = themeName(puzzle.theme);
  const levelBadge = $('#level-badge');
  levelBadge.textContent = levelName(puzzle.level);
  levelBadge.className = 'badge badge-' + puzzle.level;
  $('#rating-badge').textContent = puzzle.rating ? String(puzzle.rating) : t('sets.custom');
}

function renderProgress() {
  const progress = engine.progress();
  $('#progress-bar').style.width = progress.percent + '%';
  $('#progress-bar').classList.toggle('is-complete', progress.percent >= 100);
  $('#variants-label').textContent = t('train.variants', { done: progress.played, total: progress.total });
  const errors = $('#errors-count');
  errors.textContent = `${t('train.errors')} : ${engine.errors}`;
  errors.classList.toggle('is-clean', engine.errors === 0);
}

function renderTree() {
  const host = $('#tree-panel');
  if (!host) return;
  const state = engine.treeState();
  host.replaceChildren();

  const buildList = (nodes, path) => {
    const wrap = el('div', { class: 'tree-group' });
    for (const node of nodes) {
      const isCurrent = engine.path.join('/') === [...path, node.uci].join('/');
      const cls = [
        'tree-move',
        node.side === 'player' ? 'player' : '',
        node.state === 'solved' ? 'is-solved' : 'is-pending',
        isCurrent ? 'is-current' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const line = el('div', { class: 'tree-line' }, [
        el('span', { class: 'tree-dot' }),
        el('span', { class: cls, text: node.san }),
        evalLabel(node),
      ]);
      wrap.appendChild(line);
      if (node.children && node.children.length) {
        const indent = el('div', { class: 'tree-indent' });
        indent.appendChild(buildList(node.children, [...path, node.uci]));
        wrap.appendChild(indent);
      }
    }
    return wrap;
  };

  host.appendChild(buildList(state, []));
  host.appendChild(
    el('div', { class: 'tree-legend' }, [
      el('span', { html: '<i style="background:var(--green)"></i>' + t('tree.solved') }),
      el('span', { html: '<i style="background:var(--accent)"></i>' + t('tree.pending') }),
    ])
  );
}

function evalLabel(node) {
  if (node.mate != null) {
    return el('span', { class: 'tree-eval mate', text: `M${Math.abs(node.mate)}` });
  }
  if (node.eval != null) {
    const pawns = (node.eval / 100).toFixed(1);
    return el('span', { class: 'tree-eval', text: (node.eval > 0 ? '+' : '') + pawns });
  }
  return el('span', { class: 'tree-eval', text: '' });
}

function renderAll() {
  if (!engine || !puzzle || !session) return;
  renderBoard();
  renderMeta();
  renderProgress();
  renderTree();
  renderClocks();
}

boot().catch((err) => {
  console.error(err);
  toast(err.message, 'error');
});

