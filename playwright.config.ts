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
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
  },
});
