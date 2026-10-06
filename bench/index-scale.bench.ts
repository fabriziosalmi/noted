// How the vault index and the full-text search scale: a 10,000-note vault of notes of a realistic size, cold
// start of each, search latency, and memory. The numbers go to bench/results.json, or to $BENCH_OUT (and the console).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { generateVault } from '../electron/test-support/vault-fixture';
import { VaultIndex } from '../electron/vault-index';
import { FullTextSearchReadModel } from '../electron/fulltext-index';
import { validateFileName } from '../electron/ipc-utils';

const NOTES = Number(process.env.BENCH_NOTES ?? 10_000);
const SEARCHES = 300;
const QUERIES = ['aurora budget', 'cedar', 'delta ember falcon', 'glacier harbor', 'indigo', 'juniper kestrel lagoon', 'meadow nimbus', 'orchid pebble quartz', 'ripple', 'summit tundra'];

const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-bench-'));
  generateVault(dir, { count: NOTES, seed: 7, bodyWords: 350, frontmatterRate: 1 });
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe(`index scale (${NOTES} notes)`, () => {
  it('measures cold start, search latency and memory', async () => {
    const vaultBytes = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).reduce((n, e) => n + fs.statSync(path.join(e.parentPath, e.name)).size, 0);
    const rssBefore = process.memoryUsage().rss;

    // 1. the vault index (links, tags, headings, aliases of every note)
    let t = performance.now();
    const index = new VaultIndex({ validateFileName });
    await index.ensure(dir);
    const vaultIndexColdMs = performance.now() - t;
    const noteCount = index.names(dir).length;

    // 2. the full-text index: built on the first search
    const ft = new FullTextSearchReadModel();
    t = performance.now();
    await ft.search(dir, 'aurora', validateFileName);
    const fullTextColdMs = performance.now() - t;
    const rssAfter = process.memoryUsage().rss;

    // 3. search latency, warm
    const times: number[] = [];
    for (let i = 0; i < SEARCHES; i++) {
      const start = performance.now();
      await ft.search(dir, QUERIES[i % QUERIES.length], validateFileName);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);

    const results = {
      notes: noteCount,
      vaultMB: mb(vaultBytes),
      vaultIndexColdMs: Math.round(vaultIndexColdMs),
      fullTextColdMs: Math.round(fullTextColdMs),
      searchP50Ms: Math.round(percentile(times, 0.5) * 100) / 100,
      searchP95Ms: Math.round(percentile(times, 0.95) * 100) / 100,
      rssGrowthMB: mb(rssAfter - rssBefore),
    };
    process.stdout.write(`BENCH ${JSON.stringify(results)}\n`);
    fs.writeFileSync(path.resolve(process.env.BENCH_OUT ?? path.join(import.meta.dirname, 'results.json')), `${JSON.stringify(results, null, 2)}\n`);
  });
});
