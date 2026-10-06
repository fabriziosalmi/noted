#!/usr/bin/env node
// Judges the index benchmark (bench/index-scale.bench.ts).
//
//   node scripts/bench-compare.mjs <head.json> [<base.json>]
//
// Always enforced: the budgets for a 10,000-note vault. With a base result (the same benchmark, run on the same
// machine against the code the change started from) it also fails when a measure got more than 20% slower. Timings
// under 50 ms of difference never count: at that size the machine's noise is bigger than the change.
import fs from 'node:fs';

const BUDGETS = {
  vaultIndexColdMs: { max: 2000, label: 'vault index cold start' },
  fullTextColdMs: { max: 2000, label: 'full-text index cold start' },
  searchP95Ms: { max: 50, label: 'search p95' },
  rssGrowthMB: { max: 400, label: 'memory growth' },
};
const TOLERANCE = 0.2;
const NOISE_FLOOR = { vaultIndexColdMs: 50, fullTextColdMs: 50, searchP95Ms: 5, rssGrowthMB: 20 };

const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const [headFile, baseFile] = process.argv.slice(2);
if (!headFile) { console.error('usage: bench-compare.mjs <head.json> [<base.json>]'); process.exit(2); }

const head = load(headFile);
const base = baseFile && fs.existsSync(baseFile) ? load(baseFile) : null;
const failures = [];

for (const [key, { max, label }] of Object.entries(BUDGETS)) {
  const value = head[key];
  const verdict = value > max ? 'OVER BUDGET' : 'ok';
  const against = base ? `  (base ${base[key]})` : '';
  console.log(`${label.padEnd(28)} ${String(value).padStart(8)}  budget ${max}${against}  ${verdict}`);
  if (value > max) failures.push(`${label}: ${value} is over the budget of ${max}`);
  if (base && base[key] > 0 && value - base[key] > NOISE_FLOOR[key] && value > base[key] * (1 + TOLERANCE)) {
    failures.push(`${label}: ${value} against ${base[key]} before, more than ${TOLERANCE * 100}% slower`);
  }
}
if (!base && baseFile) console.log('No base result: only the budgets were checked.');

if (failures.length > 0) {
  console.error(`\n${failures.join('\n')}`);
  process.exit(1);
}
