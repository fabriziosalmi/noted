import { defineConfig } from 'vitest/config';

// Benchmarks are not tests: they take a while, print numbers, and write them to bench/results.json for
// scripts/bench-compare.mjs. Run with `npm run bench:index`.
export default defineConfig({
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
