#!/usr/bin/env node
// Runs the index benchmark several times and writes the median of each measure (one run is too noisy to judge).
//
//   node scripts/bench-run.mjs <out.json> [runs=3]   (from the folder holding the code to measure)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [out, runsArg] = process.argv.slice(2);
if (!out) { console.error('usage: bench-run.mjs <out.json> [runs]'); process.exit(2); }
const runs = Number(runsArg ?? 3);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-bench-run-'));
const results = [];
for (let i = 0; i < runs; i++) {
  const file = path.join(tmp, `run${i}.json`);
  execFileSync('npx', ['vitest', 'run', '--config', 'vitest.bench.config.ts'], {
    stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, BENCH_OUT: file },
  });
  results.push(JSON.parse(fs.readFileSync(file, 'utf8')));
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const merged = Object.fromEntries(Object.keys(results[0]).map(k => [k, median(results.map(r => r[k]))]));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`median of ${runs}:`, JSON.stringify(merged));
