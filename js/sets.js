// Sets page: create / duplicate / delete fixed corpora, import PGN or FEN lines.
import { $, el, initShell, toast, openModal, closeModal, goTo, onLangChange } from './app.js';
import { t, applyTranslations, themeName, ECT_THEMES } from './i18n.js';
import { loadPuzzles, filterPuzzles, pickPuzzles, registerCustomPuzzle } from './puzzle-db.js';
import {
  getSets,
  createSet,
  deleteSet,
  duplicateSet,
  getCycles,
  addPuzzleToSet,
  saveSettings,
  formatDuration,
  uid,
  getSettings,
} from './storage.js';
import { treeFromLine } from './puzzle-engine.js';
import { Chess } from '../lib/chess.js';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const state = {
  themes: new Set(ECT_THEMES),
  levels: new Set(['basic', 'intermediate', 'advanced']),
};

/* -------------------------------------------------------------------- chips */

function renderChips() {
  const themeHost = $('#theme-chips');
  themeHost.replaceChildren();
  for (const theme of ECT_THEMES) {
    const chip = el('button', {
      type: 'button',
      class: 'chip' + (state.themes.has(theme) ? ' active' : ''),
      text: themeName(theme),
    });
    chip.addEventListener('click', () => {
      if (state.themes.has(theme)) state.themes.delete(theme);
      else state.themes.add(theme);
      if (!state.themes.size) state.themes.add(theme);
      renderChips();
    });
    themeHost.appendChild(chip);
  }

  const levelHost = $('#level-chips');
  levelHost.replaceChildren();
  for (const level of ['basic', 'intermediate', 'advanced']) {
    const chip = el('button', {
      type: 'button',
      class: 'chip' + (state.levels.has(level) ? ' active' : ''),
      text: t('level.' + level),
    });
    chip.addEventListener('click', () => {
      if (state.levels.has(level)) state.levels.delete(level);
      else state.levels.add(level);
      if (!state.levels.size) state.levels.add(level);
      renderChips();
    });
    levelHost.appendChild(chip);
  }
  updateAvailable();
}

function updateAvailable() {
  const pool = filterPuzzles({ themes: [...state.themes], levels: [...state.levels] });
  const hint = $('#available-hint');
  if (hint) hint.textContent = t('sets.available', { n: pool.length });
  const input = $('#count-input');
  if (input) {
    input.max = String(Math.max(4, pool.length));
    if (Number(input.value) > pool.length) input.value = String(Math.min(pool.length, 40));
  }
}

/* --------------------------------------------------------------------- list */

function renderSets() {
  const sets = getSets();
  const host = $('#sets-list');
  const counter = $('#sets-count');
  if (counter) counter.textContent = String(sets.length);
  host.replaceChildren();
  if (!sets.length) {
    host.appendChild(el('div', { class: 'empty-state', text: t('sets.empty') }));
    return;
  }
  for (const set of sets) {
    const cycles = getCycles(set.id);
    const last = cycles[cycles.length - 1];
    const best = cycles.reduce((b, c) => (b == null || c.totalTimeMs < b ? c.totalTimeMs : b), null);
    const item = el('div', { class: 'set-item' }, [
      el('div', { class: 'set-item-head' }, [
        el('h3', { text: set.name }),
        el('span', { class: 'badge', text: last ? `C${cycles.length}` : t('sets.neverPlayed') }),
      ]),
      el('div', { class: 'set-item-meta' }, [
        el('span', { text: t('sets.puzzles', { n: set.puzzleIds.length }) }),
        el('span', { text: t('sets.cycles', { n: cycles.length }) }),
        best != null ? el('span', { text: `${t('sets.bestTime')} ${formatDuration(best)}` }) : null,
        last ? el('span', { text: `${t('sets.lastTime')} ${formatDuration(last.totalTimeMs)}` }) : null,
      ]),
      el('div', { class: 'set-actions' }, [
        el('button', {
          class: 'btn btn-sm btn-primary',
          text: t('common.play'),
          onclick: () => {
            saveSettings({ activeSetId: set.id });
            goTo('train.html', { set: set.id });
          },
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          text: t('common.duplicate'),
          onclick: () => {
            duplicateSet(set.id);
            renderSets();
            toast(t('common.duplicate'), 'ok');
          },
        }),
        el('button', {
          class: 'btn btn-sm btn-danger',
          text: t('common.delete'),
          onclick: () => {
            if (!confirm(t('common.confirmDelete'))) return;
            deleteSet(set.id);
            renderSets();
            refreshImportTargets();
          },
        }),
      ]),
    ]);
    host.appendChild(item);
  }
}

/* -------------------------------------------------------------------- forms */

function createFromForm(event) {
  event.preventDefault();
  const name = $('#set-name-input').value.trim();
  if (!name) return;
  const count = Math.max(4, Math.min(300, Number($('#count-input').value) || 40));
  const picked = pickPuzzles({ themes: [...state.themes], levels: [...state.levels], count });
  if (!picked.length) {
    toast(t('common.none'), 'error');
    return;
  }
  const set = createSet({
    name,
    puzzleIds: picked.map((p) => p.id),
    themes: [...state.themes],
    levels: [...state.levels],
  });
  saveSettings({ activeSetId: set.id });
  goTo('train.html', { set: set.id });
}

/* ------------------------------------------------------------------- import */

function refreshImportTargets() {
  const select = $('#import-target');
  if (!select) return;
  select.replaceChildren();
  const sets = getSets();
  if (!sets.length) {
    select.appendChild(el('option', { value: '', text: t('sets.importNoSet') }));
    return;
  }
  const active = getSettings().activeSetId;
  for (const set of sets) {
    select.appendChild(
      el('option', { value: set.id, text: set.name, selected: set.id === active ? 'selected' : null })
    );
  }
}

function parseImport({ format, source, setupFirst }) {
  const text = source.trim();
  if (!text) throw new Error(t('sets.importInvalid', { msg: 'empty' }));

  if (format === 'fen') {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const fen = lines[0];
    const uci = (lines[1] || '').split(/[\s,]+/).filter(Boolean);
    if (uci.length < 1) throw new Error(t('sets.importInvalid', { msg: 'no moves' }));
    const chess = new Chess(fen);
    const side = chess.turn();
    const rest = [];
    for (const move of uci) {
      const mv = chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      if (!mv) throw new Error(t('sets.importInvalid', { msg: move }));
      rest.push(move);
    }
    return { fen, setup: '', side, moves: rest };
  }

  // PGN
  const chess = new Chess();
  try {
    chess.loadPgn(text, { strict: false });
  } catch (err) {
    throw new Error(t('sets.importInvalid', { msg: err.message }));
  }
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error(t('sets.importInvalid', { msg: 'no moves' }));
  const header = chess.header();
  const startFen = header.FEN || STARTPOS;

  let moves = history.map((m) => m.from + m.to + (m.promotion || ''));
  let setup = '';
  if (setupFirst) {
    setup = moves[0];
    moves = moves.slice(1);
  }
  if (!moves.length) throw new Error(t('sets.importInvalid', { msg: 'no solution' }));

  const replay = new Chess(startFen);
  if (setup) {
    const mv = replay.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] });
    if (!mv) throw new Error(t('sets.importInvalid', { msg: setup }));
  }
  for (const move of moves) {
    const mv = replay.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    if (!mv) throw new Error(t('sets.importInvalid', { msg: move }));
  }

  return { fen: startFen, setup, moves };
}

function buildPuzzle({ fen, setup, moves, name }) {
  // rebuild the root position cleanly (the setup move must be applied on a copy)
  const chess = new Chess(fen);
  if (setup) {
    const mv = chess.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] });
    if (!mv) throw new Error(t('sets.importInvalid', { msg: setup }));
  }
  const tree = treeFromLine(chess.fen(), moves);
  return {
    id: 'c' + uid(),
    fen,
    setup,
    line: moves.join(' '),
    rating: 0,
    level: 'custom',
    theme: 'custom',
    ect: ['custom'],
    lichess: [],
    custom: true,
    name,
    tree,
  };
}

function submitImport(event) {
  event.preventDefault();
  const target = $('#import-target').value;
  const name = $('#import-name').value.trim() || t('sets.custom');
  if (!target) {
    toast(t('sets.importNoSet'), 'error');
    return;
  }
  try {
    const parsed = parseImport({
      format: $('#import-format').value,
      source: $('#import-source').value,
      setupFirst: $('#import-setup-first').checked,
    });
    const puzzle = buildPuzzle({ ...parsed, name });
    addPuzzleToSet(target, puzzle);
    registerCustomPuzzle(puzzle);
    closeModal('import-modal');
    toast(t('sets.importOk'), 'ok');
    renderSets();
  } catch (err) {
    const hint = $('#import-hint');
    if (hint) hint.textContent = err.message;
    toast(err.message, 'error');
  }
}

/* --------------------------------------------------------------------- boot */

function bind() {
  $('#btn-new-set')?.addEventListener('click', () => {
    const card = $('#create-card');
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#btn-close-create')?.addEventListener('click', () => ($('#create-card').hidden = true));
  $('#create-form')?.addEventListener('submit', createFromForm);
  $('#count-input')?.addEventListener('input', updateAvailable);

  $('#btn-import')?.addEventListener('click', () => {
    refreshImportTargets();
    if (!getSets().length) {
      toast(t('sets.importNoSet'), 'error');
      return;
    }
    openModal('import-modal');
  });
  $('#btn-close-import')?.addEventListener('click', () => closeModal('import-modal'));
  $('#import-form')?.addEventListener('submit', submitImport);
  $('#import-format')?.addEventListener('change', () => {
    const format = $('#import-format').value;
    const setupRow = $('#setup-first-row');
    if (setupRow) setupRow.hidden = format !== 'pgn';
  });

  onLangChange(() => {
    applyTranslations(document);
    renderChips();
    renderSets();
    refreshImportTargets();
  });
}

async function boot() {
  initShell();
  applyTranslations(document);
  await loadPuzzles();
  renderChips();
  renderSets();
  refreshImportTargets();
  bind();
  if (!getSets().length) {
    $('#create-card').hidden = false;
  }
}

boot().catch((err) => {
  console.error(err);
  toast(err.message, 'error');
});
