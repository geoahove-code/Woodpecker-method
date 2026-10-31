// Select a balanced corpus of puzzles from the candidate pool.
// Input : /tmp/candidates.json  Output: /tmp/selected.json
import fs from 'node:fs';

const ECT_THEMES = [
  'annihilation',
  'blockade',
  'clearance',
  'deflection',
  'discoveredAttack',
  'pin',
  'pawnStructure',
  'attraction',
  'interference',
  'doubleAttack',
];
const PER_LEVEL = Number(process.env.PER_LEVEL || 100); // per (theme, level) bucket
const levels = (rating) => (rating < 1300 ? 'basic' : rating < 1800 ? 'intermediate' : 'advanced');

const candidates = JSON.parse(fs.readFileSync('/tmp/candidates.json', 'utf8'));
console.log('candidates', candidates.length);

// Sort by quality: popularity first, then plays.
candidates.sort((a, b) => b.popularity - a.popularity || b.plays - a.plays);

const chosen = new Map(); // id -> puzzle
const byTheme = {};
for (const theme of ECT_THEMES) {
  byTheme[theme] = { basic: [], intermediate: [], advanced: [] };
  for (const p of candidates) {
    if (!p.ect.includes(theme)) continue;
    byTheme[theme][levels(p.rating)].push(p);
  }
}

// Round-robin over themes so that every theme/level bucket gets its quota while
// puzzles matched to several themes are not reused.
let added = 0;
for (const theme of ECT_THEMES) {
  for (const level of ['basic', 'intermediate', 'advanced']) {
    let need = PER_LEVEL;
    for (const p of byTheme[theme][level]) {
      if (!need) break;
      if (chosen.has(p.id)) continue;
      chosen.set(p.id, { ...p, level, primaryTheme: theme });
      need--;
      added++;
    }
    if (need > 0) console.warn(`bucket ${theme}/${level} short by ${need}`);
  }
}

// Second pass: if some buckets were short, top up from any theme to reach the target.
const target = ECT_THEMES.length * 3 * PER_LEVEL;
if (added < target) {
  for (const p of candidates) {
    if (added >= target) break;
    if (chosen.has(p.id) || !p.ect.length) continue;
    chosen.set(p.id, { ...p, level: levels(p.rating), primaryTheme: p.ect[0] });
    added++;
  }
}

const out = [...chosen.values()].sort((a, b) => a.rating - b.rating);
fs.writeFileSync('/tmp/selected.json', JSON.stringify(out, null, 0));
const dist = {};
for (const p of out) dist[p.primaryTheme + '/' + p.level] = (dist[p.primaryTheme + '/' + p.level] || 0) + 1;
console.log('selected', out.length);
console.log(Object.entries(dist).sort().map(([k, v]) => `${k}: ${v}`).join('\n'));
