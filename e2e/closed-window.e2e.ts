import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// On macOS the app stays open when its window is closed. A note changed on disk then (a Git pull, a sync, an MCP
// client) was announced to the closed window, and the main process stopped with "Object has been destroyed".

test('a note changed on disk after the window was closed does not crash the app', async ({ noted }) => {
  test.skip(process.platform !== 'darwin', 'only macOS keeps the app running with no window');
  const { app, vault } = await noted.relaunch();
  await app.evaluate(() => {
    const g = globalThis as unknown as { crashes: string[] };
    g.crashes = [];
    process.on('uncaughtException', e => { g.crashes.push(String(e?.message ?? e)); });
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.close()));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);

  fs.writeFileSync(path.join(vault, 'Changed later.md'), '# Changed later\n\nwritten while no window is open\n');
  fs.appendFileSync(path.join(vault, 'Alpha plan.md'), '<p>more</p>');
  await new Promise(r => setTimeout(r, 1500)); // the watcher reports changes after a short delay

  expect(await app.evaluate(() => (globalThis as unknown as { crashes: string[] }).crashes)).toEqual([]);
});
