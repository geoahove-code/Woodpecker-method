// Static integration checks: DOM ids used by controllers, i18n keys, import paths.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const pages = ['index.html', 'train.html', 'sets.html', 'stats.html'];
// each controller owns one page; app.js owns the dashboard (and the shared shell)
const scriptPage = {
  'js/app.js': 'index.html',
  'js/train.js': 'train.html',
  'js/sets.js': 'sets.html',
  'js/stats.js': 'stats.html',
};
const shellIds = ['sound-toggle', 'lang-toggle', 'toast-host'];

const problems = [];
const ids = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const pageIds = Object.fromEntries(pages.map((p) => [p, ids(read(p))]));

// ---------------------------------------------------------------- 1. DOM ids
for (const [script, page] of Object.entries(scriptPage)) {
  const code = read(script);
  const used = new Set();
  for (const m of code.matchAll(/\$\('#([\w-]+)'\)/g)) used.add(m[1]);
  for (const m of code.matchAll(/getElementById\('([\w-]+)'\)/g)) used.add(m[1]);
  for (const m of code.matchAll(/openModal\('([\w-]+)'\)/g)) used.add(m[1]);
  for (const m of code.matchAll(/closeModal\('([\w-]+)'\)/g)) used.add(m[1]);
  const missing = [...used].filter((id) => !pageIds[page].has(id));
  if (missing.length) problems.push(`${script} -> ${page}: missing ids ${missing.join(', ')}`);
}

for (const page of pages) {
  const missingShell = shellIds.filter((id) => !pageIds[page].has(id));
  if (missingShell.length) problems.push(`${page}: missing shell ids ${missingShell.join(', ')}`);
  // every inline handler / button referenced by CSS state must exist per page
  if (!/data-page=/.test(read(page))) problems.push(`${page}: missing data-page attribute`);
}

// ------------------------------------------------------------- 2. i18n keys
globalThis.document = {
  documentElement: {},
  dispatchEvent() {},
  querySelectorAll: () => [],
  addEventListener() {},
};
const { setLang, t, ECT_THEMES } = await import('../js/i18n.js');

const keys = new Set();
for (const page of pages) {
  const html = read(page);
  for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) keys.add(m[1]);
}
for (const file of fs.readdirSync(path.join(root, 'js'))) {
  if (!file.endsWith('.js')) continue;
  const code = read(path.join('js', file));
  for (const m of code.matchAll(/\bt\('([\w.-]+)'/g)) {
    if (!m[1].endsWith('.')) keys.add(m[1]);
  }
}
for (const theme of ECT_THEMES) {
  keys.add('theme.' + theme);
  keys.add('theme.' + theme + '.desc');
}
for (const level of ['basic', 'intermediate', 'advanced', 'custom']) keys.add('level.' + level);

for (const lang of ['fr', 'en']) {
  setLang(lang);
  const missing = [...keys].filter((key) => t(key) === key);
  if (missing.length) problems.push(`i18n[${lang}] missing keys -> ${missing.join(', ')}`);
}

// ---------------------------------------------------------- 3. module graph
function checkImports(file) {
  const code = read(file);
  for (const m of code.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = path.normalize(path.join(path.dirname(file), spec));
    if (!exists(target)) problems.push(`${file}: missing import ${spec}`);
  }
}
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (rel.endsWith('.js') || rel.endsWith('.mjs')) checkImports(rel);
  }
};
walk('js');
checkImports('sw.js');

// ---------------------------------------------- 4. html assets + SW precache
for (const page of pages) {
  const html = read(page);
  for (const m of html.matchAll(/(?:href|src)="([^":]+\.(?:css|js))"/g)) {
    if (!exists(m[1])) problems.push(`${page}: missing asset ${m[1]}`);
  }
}
const sw = read('sw.js');
for (const m of sw.matchAll(/'([\w./-]+\.(?:css|js|json|woff2))'/g)) {
  if (!exists(m[1])) problems.push(`sw.js: precached file missing ${m[1]}`);
}

if (problems.length) {
  console.error('FAILED\n' + problems.join('\n'));
  process.exit(1);
}
console.log(
  `OK — ${pages.length} pages, ${keys.size} i18n keys x2 languages, imports, assets and service worker precache all resolve`
);
