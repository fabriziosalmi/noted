import { defineConfig } from '@playwright/test';

// Electron E2E. Runs against the built bundles (`npm run build:bundles` first),
// one worker: every test launches the real app with its own throwaway vault and
// profile, and the app is a singleton-ish desktop process.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // The CI runners (Windows above all) are sometimes several times slower than a laptop; a test that merely has to
  // wait longer must not be a failure, and a hung one is still caught.
  timeout: process.env.CI ? 90_000 : 60_000,
  expect: { timeout: process.env.CI ? 15_000 : 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
  },
});
