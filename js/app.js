// Shared shell (nav, language, sound, toasts, modals) + dashboard page.
import {
  getSettings,
  saveSettings,
  getSets,
  getCycles,
  getGlobalStats,
  formatDuration,
  formatDate,
} from './storage.js';
import { setLang, applyTranslations, t, getLang, ECT_THEMES, themeName, themeDesc } from './i18n.js';
import { loadPuzzles, themeCounts, pickPuzzles } from './puzzle-db.js';
import { createSet } from './storage.js';
import { sound } from './sound.js';
import { lineChart } from './charts.js';
import { activeSessionSummary } from './woodpecker.js';

/* ------------------------------------------------------------------ helpers */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function toast(message, kind = '') {
  const host = $('#toast-host');
  if (!host) return;
  const node = el('div', { class: 'toast ' + kind, text: message });
  host.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = false;
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

export function goTo(page, params = {}) {
  const url = new URL(page, location.href);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  location.href = url.toString();
}

/* -------------------------------------------------------------------- shell */

function syncSoundButton() {
  const settings = getSettings();
  document.body.classList.toggle('sound-off', !settings.sound);
  sound.setEnabled(settings.sound);
  const btn = $('#sound-toggle');
  if (btn) btn.setAttribute('title', settings.sound ? t('nav.soundOn') : t('nav.soundOff'));
}

function syncLangButton() {
  const btn = $('#lang-toggle');
  if (btn) btn.textContent = getLang() === 'fr' ? 'FR / EN' : 'EN / FR';
}

let shellReady = false;

export function initShell() {
  if (shellReady) return;
  shellReady = true;
  const settings = getSettings();
  setLang(settings.lang);
  sound.setEnabled(settings.sound);
  applyTranslations(document);
  syncSoundButton();
  syncLangButton();

  $('#sound-toggle')?.addEventListener('click', () => {
    const next = !getSettings().sound;
    saveSettings({ sound: next });
    syncSoundButton();
  });

  $('#lang-toggle')?.addEventListener('click', () => {
    const next = getLang() === 'fr' ? 'en' : 'fr';
    saveSettings({ lang: next });
    setLang(next);
    applyTranslations(document);
    syncSoundButton();
    syncLangButton();
    document.dispatchEvent(new CustomEvent('wp:lang', { detail: { lang: next } }));
  });

  // close modals on backdrop click
  for (const modal of $$('.modal')) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const modal of $$('.modal')) modal.hidden = true;
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

export function onLangChange(handler) {
  document.addEventListener('wp:lang', handler);
}

/* ---------------------------------------------------------------- dashboard */

function kpiCard(label, value, sub, accent) {
  return el('div', { class: 'kpi' }, [
    el('span', { class: 'kpi-label', text: label }),
    el('span', { class: 'kpi-value' + (accent ? ' accent' : ''), text: value }),
    sub ? el('span', { class: 'kpi-sub', text: sub }) : null,
  ]);
}

function bestSetForChart(sets) {
  let best = null;
  for (const set of sets) {
    const cycles = getCycles(set.id);
    if (cycles.length && (!best || cycles.length > getCycles(best.id).length)) best = set;
  }
  return best;
}

function renderDashboard() {
  const stats = getGlobalStats();
  const sets = getSets();
  const summary = activeSessionSummary();

  // hero primary action
  const primary = $('#hero-primary');
  if (primary) {
    if (summary) {
      primary.textContent = t('dash.resumeCycle');
      primary.href = `train.html?set=${summary.set.id}`;
    } else {
      primary.textContent = t('dash.startCycle');
      primary.href = sets.length ? `train.html?set=${sets[0].id}` : 'sets.html';
    }
  }

  const kpis = $('#dash-kpis');
  if (kpis) {
    kpis.replaceChildren(
      kpiCard(t('dash.kpi.solved'), String(stats.solved), t('stats.samples', { n: stats.attempts })),
      kpiCard(t('dash.kpi.cycles'), String(stats.cycles), `${sets.length} ${t('sets.title').toLowerCase()}`),
      kpiCard(t('dash.kpi.time'), formatDuration(stats.timeMs)),
      kpiCard(
        t('dash.kpi.accuracy'),
        stats.accuracy == null ? '—' : Math.round(stats.accuracy * 100) + '%',
        null,
        true
      )
    );
  }

  // progression chart for the most practised set
  const chartHost = $('#progression-chart');
  const chartLabel = $('#progression-set');
  const chartSet = bestSetForChart(sets);
  if (chartHost) {
    chartHost.replaceChildren();
    if (!chartSet) {
      chartHost.appendChild(el('div', { class: 'empty-state', text: t('dash.progressionEmpty') }));
      if (chartLabel) chartLabel.textContent = '';
    } else {
      const cycles = getCycles(chartSet.id);
      const points = cycles.map((c, i) => ({ label: 'C' + c.index, value: c.totalTimeMs }));
      chartHost.appendChild(
        lineChart(points, { format: (v) => formatDuration(v) })
      );
      if (chartLabel) {
        const last = cycles[cycles.length - 1];
        const prev = cycles[cycles.length - 2];
        const comp = last && prev && prev.totalTimeMs ? last.totalTimeMs / prev.totalTimeMs : null;
        chartLabel.textContent =
          chartSet.name +
          (comp != null ? ` · ${t('dash.compression')} ${Math.round((1 - comp) * 100)}%` : '');
      }
    }
  }

  // sets list
  const setList = $('#dash-sets');
  if (setList) {
    setList.replaceChildren();
    if (!sets.length) {
      setList.appendChild(el('div', { class: 'empty-state', text: t('dash.noSets') }));
    }
    for (const set of sets.slice(0, 4)) {
      const cycles = getCycles(set.id);
      const last = cycles[cycles.length - 1];
      const item = el('div', { class: 'set-item' }, [
        el('div', { class: 'set-item-head' }, [
          el('h3', { text: set.name }),
          el('span', { class: 'badge', text: last ? t('dash.currentCycle', { n: cycles.length }) : t('sets.neverPlayed') }),
        ]),
        el('div', { class: 'set-item-meta' }, [
          el('span', {}, [el('strong', { text: String(set.puzzleIds.length) }), ' ' + t('sets.puzzles', { n: '' }).trim()]),
          last ? el('span', { text: `${t('sets.lastTime')} ${formatDuration(last.totalTimeMs)}` }) : null,
        ]),
        el('div', { class: 'set-actions' }, [
          el('a', {
            class: 'btn btn-sm btn-primary',
            href: `train.html?set=${set.id}`,
            text: last ? t('common.resume') : t('common.play'),
          }),
          el('a', { class: 'btn btn-sm btn-ghost', href: 'stats.html', text: t('nav.stats') }),
        ]),
      ]);
      setList.appendChild(item);
    }
  }

  // theme grid
  const grid = $('#theme-grid');
  if (grid) {
    const counts = themeCounts();
    grid.replaceChildren();
    for (const theme of ECT_THEMES) {
      const card = el('button', { class: 'theme-card', type: 'button' }, [
        el('h3', { text: themeName(theme) }),
        el('p', { text: themeDesc(theme) }),
        el('div', { class: 'theme-card-foot' }, [
          el('span', { class: 'num', text: `${counts[theme] || 0}` }),
          el('span', { class: 'link', text: t('dash.quickSet') }),
        ]),
      ]);
      card.addEventListener('click', () => startQuickSession(theme));
      grid.appendChild(card);
    }
  }
}

async function startQuickSession(theme) {
  await loadPuzzles();
  const picked = pickPuzzles({ themes: [theme], count: 20 });
  if (!picked.length) {
    toast(t('common.none'), 'error');
    return;
  }
  const set = createSet({
    name: `${themeName(theme)} · ${formatDate(Date.now(), getLang())}`,
    puzzleIds: picked.map((p) => p.id),
    themes: [theme],
    levels: [],
  });
  saveSettings({ activeSetId: set.id });
  goTo('train.html', { set: set.id });
}

/* --------------------------------------------------------------------- boot */

initShell();
if (document.body.dataset.page === 'dashboard') {
  loadPuzzles()
    .then(() => renderDashboard())
    .catch((err) => {
      console.error(err);
      toast('data/puzzles.json · ' + err.message, 'error');
    });
  onLangChange(renderDashboard);
}

export { renderDashboard };
