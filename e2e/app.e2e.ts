import { test, expect, SEED_NOTES } from './fixtures';

const MOD = 'ControlOrMeta';

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
