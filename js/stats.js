// Statistics page: KPI, compression curve, per-theme accuracy, error heat map, history.
import { $, el, initShell, onLangChange } from './app.js';
import { t, applyTranslations, ECT_THEMES, themeName, levelName, getLang } from './i18n.js';
import { getAllCycles, getGlobalStats, formatDuration, formatDate } from './storage.js';
import { lineChart, barList } from './charts.js';

const LEVELS = ['basic', 'intermediate', 'advanced'];

function renderKpis() {
  const stats = getGlobalStats();
  const host = $('#stats-kpis');
  if (!host) return;
  const accuracy = stats.accuracy == null ? '—' : Math.round(stats.accuracy * 100) + '%';
  host.replaceChildren(
    ...[
      [t('dash.kpi.cycles'), String(stats.cycles), ''],
      [t('dash.kpi.solved'), String(stats.solved), ''],
      [t('dash.kpi.accuracy'), accuracy, 'accent'],
      [t('dash.kpi.time'), formatDuration(stats.timeMs), ''],
    ].map(([label, value, tone]) =>
      el('div', { class: 'kpi' }, [
        el('span', { class: 'kpi-label', text: label }),
        el('span', { class: 'kpi-value' + (tone ? ' ' + tone : ''), text: value }),
      ])
    )
  );
}

function renderCurve() {
  const host = $('#curve-chart');
  if (!host) return;
  const cycles = getAllCycles().sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  host.replaceChildren();
  if (!cycles.length) {
    host.appendChild(el('div', { class: 'empty-state', text: t('stats.empty') }));
    return;
  }
  const points = cycles.map((c, i) => ({ label: 'C' + c.index, value: c.totalTimeMs }));
  host.appendChild(lineChart(points, { format: (v) => formatDuration(v) }));
}

function renderThemeBars() {
  const host = $('#theme-bars');
  if (!host) return;
  const { byTheme } = getGlobalStats();
  const rows = ECT_THEMES.filter((theme) => byTheme[theme]).map((theme) => {
    const entry = byTheme[theme];
    const attempts = entry.solved + entry.failed;
    const rate = attempts ? entry.solved / attempts : 0;
    return {
      label: themeName(theme),
      value: rate,
      hint: `${Math.round(rate * 100)}% · ${attempts}`,
      tone: rate >= 0.75 ? 'good' : rate < 0.5 ? 'bad' : undefined,
    };
  });
  host.replaceChildren(
    rows.length ? barList(rows) : el('div', { class: 'empty-state', text: t('stats.empty') })
  );
}

function heatColor(rate) {
  // 0 errors -> green, 100% errors -> red
  const hue = Math.round((1 - rate) * 130); // 130 = green, 0 = red
  return `hsl(${hue} 62% 26%)`;
}

function renderHeatmap() {
  const host = $('#heatmap');
  if (!host) return;
  const { byThemeLevel } = getGlobalStats();
  host.replaceChildren();
  host.appendChild(el('div', { class: 'heat-cell head', text: t('sets.themes') }));
  for (const level of LEVELS) host.appendChild(el('div', { class: 'heat-cell head', text: levelName(level) }));
  for (const theme of ECT_THEMES) {
    host.appendChild(el('div', { class: 'heat-cell row-label', text: themeName(theme) }));
    for (const level of LEVELS) {
      const entry = byThemeLevel[theme + '|' + level];
      const attempts = entry ? entry.solved + entry.failed : 0;
      const failRate = entry && attempts ? entry.failed / attempts : null;
      const cell = el('div', {
        class: 'heat-cell',
        text: attempts ? `${Math.round(failRate * 100)}%` : '—',
        title: t('stats.samples', { n: attempts }),
      });
      if (attempts) {
        cell.style.background = heatColor(failRate);
        cell.style.borderColor = 'transparent';
      }
      host.appendChild(cell);
    }
  }
}

function renderHistory() {
  const body = $('#history-body');
  if (!body) return;
  const cycles = getAllCycles().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  body.replaceChildren();
  if (!cycles.length) {
    const row = el('tr');
    row.appendChild(el('td', { colspan: '8', class: 'muted', text: t('stats.empty') }));
    body.appendChild(row);
    return;
  }
  for (const cycle of cycles) {
    const previous = cycles
      .filter((c) => c.setId === cycle.setId && c.index === cycle.index - 1)
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
    const compression =
      previous && previous.totalTimeMs ? 1 - cycle.totalTimeMs / previous.totalTimeMs : null;
    const total = (cycle.solved || 0) + (cycle.failed || 0);
    const accuracy = total ? Math.round(((cycle.solved || 0) / total) * 100) : 0;
    body.appendChild(
      el('tr', {}, [
        el('td', { text: cycle.setName || '—' }),
        el('td', { text: 'C' + cycle.index }),
        el('td', { text: formatDate(cycle.finishedAt, getLang()) }),
        el('td', { class: 'num', text: formatDuration(cycle.totalTimeMs) }),
        el('td', { class: 'num good', text: String(cycle.solved || 0) }),
        el('td', { class: 'num bad', text: String(cycle.failed || 0) }),
        el('td', { class: 'num', text: accuracy + '%' }),
        el('td', {
          class: 'num ' + (compression == null ? '' : compression >= 0 ? 'good' : 'bad'),
          text: compression == null ? '—' : `${compression >= 0 ? '−' : '+'}${Math.abs(Math.round(compression * 100))}%`,
        }),
      ])
    );
  }
}

function render() {
  renderKpis();
  renderCurve();
  renderThemeBars();
  renderHeatmap();
  renderHistory();
}

initShell();
applyTranslations(document);
render();
onLangChange(() => {
  applyTranslations(document);
  render();
});
