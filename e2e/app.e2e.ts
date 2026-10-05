import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

const MOD = 'ControlOrMeta';

/** Record which vault-change events reach the renderer, to explain a failure. */
async function recordExternalEvents(win: import('@playwright/test').Page) {
  await win.evaluate(() => {
    const w = window as unknown as { __ext: string[] };
    w.__ext = [];
    window.electronAPI.onNoteChangedExternally?.((n: string) => w.__ext.push(n));
  });
}

async function withContext<T>(win: import('@playwright/test').Page, readVault: () => Record<string, string>, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const events = await win.evaluate(() => (window as unknown as { __ext?: string[] }).__ext ?? null).catch(() => null);
    const vault = readVault();
    throw new Error(`${(e as Error).message}\n[context] renderer saw events=${JSON.stringify(events)} files=${JSON.stringify(Object.keys(vault))} Beta notes.md=${JSON.stringify(vault['Beta notes.md'])}`);
  }
}

test.describe('Noted desktop app', () => {
  test('opens a vault and lists its notes', async ({ noted }) => {
    const { win } = noted;
    for (const [name] of SEED_NOTES) {
      await expect(win.getByText(name.replace(/\.md$/, ''), { exact: true }).first()).toBeVisible();
    }
  });

  test('editing a note autosaves it to disk', async ({ noted }) => {
    const { win, readVault } = noted;
    await win.getByText('Beta notes', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' edited-by-e2e');
    await expect.poll(() => readVault()['Beta notes.md'], { timeout: 15_000 }).toContain('edited-by-e2e');
  });

  test('renaming a note renames the file on disk', async ({ noted }) => {
    const { win, readVault } = noted;
    await win.keyboard.press(`${MOD}+KeyN`);
    await expect(win.locator('[contenteditable="true"]').first()).toBeVisible();
    // A new note opens with focus in its (empty) title heading; clicking would
    // move the caret into the body. The title -> filename sync is debounced.
    await win.keyboard.type('Delta rename check');
    await expect
      .poll(() => Object.keys(readVault()).some(f => f.startsWith('Delta rename check')), { timeout: 15_000 })
      .toBe(true);
  });

  test('global search finds a note by its body text', async ({ noted }) => {
    const { win } = noted;
    await win.keyboard.press(`${MOD}+Shift+KeyF`);
    await win.keyboard.type('lighthouse');
    await expect(win.getByText('Gamma ideas').last()).toBeVisible();
  });

  test('quitting right after typing still flushes the edit', async ({ noted }) => {
    const { win, relaunch } = noted;
    await win.getByText('Alpha plan', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' flushed-on-quit');
    // No wait: quit immediately, inside the autosave debounce window.
    const again = await relaunch();
    expect(again.readVault()['Alpha plan.md']).toContain('flushed-on-quit');
  });

  test('a note changed on disk while open reloads in the editor and is not overwritten', async ({ noted }) => {
    const { win, vault, readVault } = noted;
    await win.getByText('Beta notes', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Weekly sync');
    await recordExternalEvents(win);
    // Another device / a git pull / an MCP client rewrites the file.
    fs.writeFileSync(path.join(vault, 'Beta notes.md'), '<h1>Beta notes</h1><p>edited by another device</p>');
    await withContext(win, readVault, () => expect(editor).toContainText('edited by another device'));
    // Autosave must not put the stale text back over it.
    await win.waitForTimeout(1500);
    expect(readVault()['Beta notes.md']).toContain('edited by another device');
  });

  test('a change on disk while the user is typing keeps both versions', async ({ noted }) => {
    const { win, vault, readVault } = noted;
    await win.getByText('Beta notes', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Weekly sync');
    await recordExternalEvents(win);
    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' LOCAL-TYPING');
    // Inside the autosave window, the file changes underneath.
    fs.writeFileSync(path.join(vault, 'Beta notes.md'), '<h1>Beta notes</h1><p>edited by another device</p>');
    const copyName = () => Object.keys(readVault()).find(f => f.includes('(other version)'));
    await withContext(win, readVault, () => expect.poll(copyName, { timeout: 15_000 }).toBeTruthy());
    expect(readVault()[copyName()!]).toContain('edited by another device');
    await expect.poll(() => readVault()['Beta notes.md'], { timeout: 15_000 }).toContain('LOCAL-TYPING');
  });

  test('"Check for Updates" degrades gracefully with no network or packaged build', async ({ noted }) => {
    const { app, win } = noted;
    // Capture the message box instead of letting a native dialog block the run.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __dialogs: string[] };
      g.__dialogs = [];
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const opts = (args.length > 1 ? args[1] : args[0]) as { title?: string };
        g.__dialogs.push(opts.title ?? '');
        return { response: 0, checkboxChecked: false };
      }) as unknown as typeof dialog.showMessageBox;
    });
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById?.('check-for-updates')
        ?? findByLabel(Menu.getApplicationMenu()?.items ?? [], 'Check for Updates');
      item?.click();
      function findByLabel(items: Electron.MenuItem[], label: string): Electron.MenuItem | undefined {
        for (const it of items) {
          if (it.label.startsWith(label)) return it;
          const sub = it.submenu ? findByLabel(it.submenu.items, label) : undefined;
          if (sub) return sub;
        }
        return undefined;
      }
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { __dialogs: string[] }).__dialogs))
      .toContain('Updates unavailable');
    // The app is still alive and responsive afterwards.
    await expect(win.getByText('Alpha plan', { exact: true }).first()).toBeVisible();
  });
});
