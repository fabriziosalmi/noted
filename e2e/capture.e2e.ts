import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// Quick capture with a target (#94), through the real IPC the capture window calls: a line goes to today's daily note or the Inbox, in
// the vault's own format, and a note that is open in the editor takes the new line instead of keeping a stale copy.
const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
};

test('quick capture: daily and inbox targets append in the vault format; an open note picks the line up', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Anchor.md'), '# Anchor\n\nhello\n');

  const { win, vault } = await noted.relaunch();
  await expect(win.getByText('Anchor', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const capture = (text: string, target?: string) =>
    win.evaluate(([t, g]) => (window as unknown as { electronAPI: { saveCapture: (a: string, b?: string) => Promise<{ success: boolean; fileName?: string }> } }).electronAPI.saveCapture(t, g), [text, target] as const);

  // The first daily capture makes today's note with its sections; the next one goes in the first section, above the rest
  expect(await capture('call Paolo', 'daily')).toMatchObject({ success: true, fileName: today() });
  expect(await capture('second thought', 'daily')).toMatchObject({ success: true, fileName: today() });
  const daily = fs.readFileSync(path.join(vault, today()), 'utf8');
  expect(daily).toMatch(/^# .+\n\n## Notes\n\n\*\*\d\d:\d\d\*\* call Paolo\n\n\*\*\d\d:\d\d\*\* second thought\n\n## To do\n/);

  // The Inbox is one standing note
  await capture('buy stamps', 'inbox');
  await capture('renew passport', 'inbox');
  expect(fs.readFileSync(path.join(vault, 'Inbox.md'), 'utf8')).toMatch(/^# Inbox\n\n\*\*\d\d:\d\d\*\* buy stamps\n\n\*\*\d\d:\d\d\*\* renew passport\n$/);

  // No target (an older caller) is still a note of its own, and something that is not a target is too
  expect(await capture('loose', undefined)).toMatchObject({ success: true });
  expect(await capture('odd', '../../etc')).toMatchObject({ success: true });
  const captures = fs.readdirSync(vault).filter(f => f.startsWith('Capture_'));
  expect(captures).toHaveLength(2);

  // A note that is open in the editor takes the line: it is not left stale for the next autosave to erase
  await win.getByText(today().replace('.md', ''), { exact: true }).first().click();
  await expect(win.locator('.ProseMirror')).toContainText('second thought');
  await capture('arrived while open', 'daily');
  await expect(win.locator('.ProseMirror')).toContainText('arrived while open', { timeout: 15_000 });
  await win.locator('.ProseMirror').click();
  await win.keyboard.type(' and a word of mine');
  await expect.poll(() => fs.readFileSync(path.join(vault, today()), 'utf8'), { timeout: 15_000 }).toContain('a word of mine');
  expect(fs.readFileSync(path.join(vault, today()), 'utf8')).toContain('arrived while open');
});

test('quick capture window: names the target in the language of the app, saves to it, and remembers the choice', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Anchor.md'), '# Anchor\n\nhello\n');
  const { win, app, vault } = await noted.relaunch();
  await expect(win.getByText('Anchor', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  const openCapture = async (label = 'Quick Capture') => {
    const opened = app.waitForEvent('window');
    await app.evaluate(({ Menu }, name) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const i of items) { if (i.label === name) return i; const f = i.submenu && find(i.submenu.items); if (f) return f; }
        return undefined;
      };
      find(Menu.getApplicationMenu()!.items)!.click();
    }, label);
    const page = await opened;
    await page.waitForLoadState('domcontentloaded');
    return page;
  };

  // Nothing remembered yet: a new note; the labels are the app's, not the page's English
  let page = await openCapture();
  await expect(page.locator('#target')).toHaveValue('new');
  await expect(page.locator('#target option')).toHaveText(['A new note', "Today's daily note", 'Inbox note']);

  await page.locator('#target').selectOption('daily');
  await page.locator('#note').fill('from the window');
  await page.locator('#save').click();
  await expect.poll(() => fs.existsSync(path.join(vault, today())), { timeout: 15_000 }).toBe(true);
  expect(fs.readFileSync(path.join(vault, today()), 'utf8')).toMatch(/## Notes\n\n\*\*\d\d:\d\d\*\* from the window\n\n## To do/);
  await expect.poll(() => page.isClosed(), { timeout: 15_000 }).toBe(true);

  // The next capture starts where the last one ended
  page = await openCapture();
  await expect(page.locator('#target')).toHaveValue('daily');
  await page.locator('#note').fill('and again');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => fs.readFileSync(path.join(vault, today()), 'utf8'), { timeout: 15_000 }).toContain('and again');
  expect(fs.readdirSync(vault).filter(f => f.startsWith('Capture_'))).toHaveLength(0);
});

test('quick capture window: says everything in the language of the app', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, 'Anchor.md'), '# Anchor\n\nhello\n');
  const { win, app } = await noted.relaunch();
  await expect(win.getByText('Anchor', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await win.getByRole('button', { name: 'Settings' }).click();
  await win.getByRole('tab', { name: 'Appearance' }).click();
  await win.getByRole('combobox', { name: 'Language' }).selectOption('it');
  await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.some(t => t.submenu?.items.some(i => i.label === 'Cattura rapida'))), { timeout: 15_000 }).toBe(true);

  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) { if (i.label === 'Cattura rapida') return i; const f = i.submenu && find(i.submenu.items); if (f) return f; }
      return undefined;
    };
    find(Menu.getApplicationMenu()!.items)!.click();
  });
  const page = await opened;
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#title')).toHaveText('Cattura rapida');
  await expect(page.locator('#target-label')).toHaveText('Salva in');
  await expect(page.locator('#target option')).toHaveText(['Una nuova nota', 'Nota del giorno', 'Nota Inbox']);
  await expect(page.locator('#note')).toHaveAttribute('placeholder', 'Scrivi qui…');
  await expect(page.locator('#save')).toHaveText('Salva');
});

test('quick capture window: closes with Escape and with the close button, nothing saved', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, 'Anchor.md'), '# Anchor\n\nhello\n');
  const { win, app, vault } = await noted.relaunch();
  await expect(win.getByText('Anchor', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const open = async () => {
    const opened = app.waitForEvent('window');
    await app.evaluate(({ Menu }) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const i of items) { if (i.label === 'Quick Capture') return i; const f = i.submenu && find(i.submenu.items); if (f) return f; }
        return undefined;
      };
      find(Menu.getApplicationMenu()!.items)!.click();
    });
    const page = await opened;
    await page.waitForLoadState('domcontentloaded');
    return page;
  };

  let page = await open();
  await page.locator('#note').fill('typed but not saved');
  // The window closes under the call, which Playwright reports as an error: that is the behaviour being checked
  await page.keyboard.press('Escape').catch(() => undefined);
  await expect.poll(() => page.isClosed(), { timeout: 10_000 }).toBe(true);

  page = await open();
  await page.locator('#close').click().catch(() => undefined);
  await expect.poll(() => page.isClosed(), { timeout: 10_000 }).toBe(true);

  expect(fs.readdirSync(vault).filter(f => f !== 'Anchor.md' && !f.startsWith('.'))).toEqual([]);
});
