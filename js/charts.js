// Minimal SVG chart helpers (no dependency, styled through CSS classes).

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Line chart of cycle durations.
 * @param {{label:string, value:number}[]} points
 */
export function lineChart(points, { width = 640, height = 200, format = (v) => v } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart chart-line', role: 'img' });
  if (!points.length) return svg;
  const pad = { l: 46, r: 14, t: 16, b: 26 };
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const min = 0;
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (i) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => pad.t + h - ((v - min) / (max - min || 1)) * h;

  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (h / 4) * i;
    svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: gy, y2: gy, class: 'chart-grid' }));
  }
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  svg.appendChild(
    el('path', {
      d: `${path} L${x(points.length - 1)},${pad.t + h} L${x(0)},${pad.t + h} Z`,
      class: 'chart-area',
    })
  );
  svg.appendChild(el('path', { d: path, class: 'chart-stroke' }));

  points.forEach((p, i) => {
    svg.appendChild(el('circle', { cx: x(i), cy: y(p.value), r: 4, class: 'chart-dot' }));
    if (points.length <= 12 || i % Math.ceil(points.length / 12) === 0) {
      svg.appendChild(
        el('text', { x: x(i), y: height - 8, class: 'chart-label', 'text-anchor': 'middle' }, p.label)
      );
    }
  });
  for (let i = 0; i <= 2; i++) {
    const v = max - ((max - min) / 2) * i;
    svg.appendChild(
      el('text', { x: pad.l - 8, y: y(v) + 4, class: 'chart-label', 'text-anchor': 'end' }, format(v))
    );
  }
  return svg;
}

/**
 * Horizontal bars (values in 0..1).
 * @param {{label:string, value:number, hint?:string, tone?:string}[]} rows
 */
export function barList(rows, { format = (v) => Math.round(v * 100) + '%' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'bars';
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'bar-row';
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = row.label;
    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.round((row.value || 0) * 100)}%`;
    if (row.tone) fill.dataset.tone = row.tone;
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = row.hint || format(row.value || 0);
    item.append(label, track, value);
    wrap.appendChild(item);
  }
  return wrap;
}
