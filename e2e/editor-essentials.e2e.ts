import fs from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// What every editor has and Noted lacked: a right-click menu, zoom, coming back to a note where it was left, Back and
// Forward, a window that reopens as it was left, find and replace, and links that open on ⌘/Ctrl+click.

const MOD = 'ControlOrMeta';
const isMac = process.platform === 'darwin';
const lines = (n: number) => Array.from({ length: n }, (_, i) => `<p>Line ${i + 1} of a long note.</p>`).join('');

const seed = (vault: string, notes: Record<string, string>) => {
  for (const f of fs.readdirSync(vault)) if (f.endsWith('.md')) fs.rmSync(path.join(vault, f));
  for (const [name, html] of Object.entries(notes)) fs.writeFileSync(path.join(vault, name), html);
};
const open = async (win: Page, title: string) => {
  await win.getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
  await expect(win.locator('[contenteditable="true"] h1').first()).toHaveText(title);
};
const clickMenu = (app: ElectronApplication, label: string) => app.evaluate(({ Menu, BrowserWindow }, label) => {
  const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
    for (const i of items) { if (i.label === label && i.visible) return i; const f = i.submenu && find(i.submenu.items); if (f) return f; }
    return undefined;
  };
  const item = find(Menu.getApplicationMenu()!.items);
  if (!item) throw new Error(`no menu item ${label}`);
  item.click(undefined, BrowserWindow.getAllWindows()[0], BrowserWindow.getAllWindows()[0].webContents);
}, label);

test.describe('editor essentials', () => {
  // Record the right-click menu instead of showing it: a native menu blocks until it is dismissed.
  const recordMenus = async (app: ElectronApplication) => {
    await app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { menus: Electron.Menu[] };
      g.menus = [];
      Menu.prototype.popup = function (this: Electron.Menu) { g.menus.push(this); };
    });
    return () => app.evaluate(() => (globalThis as unknown as { menus: Electron.Menu[] }).menus.at(-1)?.items.map(i => i.label) ?? []);
  };

  test('right-click in a note shows the edit actions', async ({ noted }) => {
    seed(noted.vault, { 'Spell.md': '<h1>Spell</h1><p>I wrote a word.</p>' });
    const { win, app } = await noted.relaunch();
    await open(win, 'Spell');
    const labels = await recordMenus(app);
    await win.locator('[contenteditable="true"] p').first().click({ button: 'right' });
    await expect.poll(labels).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Paste as Plain Text', 'Select All']));
  });

  test('a spelling suggestion from the right-click menu replaces the misspelled word', async ({ noted }) => {
    // The suggestions come from the system spellchecker. On macOS it is the user's; on the hosted macOS runner it gave
    // none for 20 s in two attempts of the same run (main, 7547f22), so this runs on a real Mac only.
    test.skip(!isMac || !!process.env.CI, 'spelling suggestions come from the macOS spellchecker of a real machine');
    seed(noted.vault, { 'Spell.md': '<h1>Spell</h1><p>I wrote teh word.</p>' });
    const { win, app } = await noted.relaunch();
    await open(win, 'Spell');
    const labels = await recordMenus(app);
    // Chromium checks spelling as text is typed, so the misspelling is typed (at the end of the line).
    const word = win.locator('[contenteditable="true"] p').first();
    await word.click();
    await win.keyboard.press('Meta+ArrowRight');
    await win.keyboard.type(' my hosue ', { delay: 30 }); // a word is checked once a space ends it
    const at = await word.evaluate(p => {
      const text = p.firstChild as Text;
      const r = document.createRange();
      r.setStart(text, text.data.indexOf('hosue') + 2);
      r.setEnd(text, text.data.indexOf('hosue') + 3);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await expect.poll(async () => {
      await win.mouse.click(at.x, at.y, { button: 'right' });
      return labels();
    }, { timeout: 20_000, intervals: [500] }).toContain('house');
    await app.evaluate(() => {
      const m = (globalThis as unknown as { menus: Electron.Menu[] }).menus.at(-1)!;
      m.items.find(i => i.label === 'house')!.click();
    });
    await expect(word).toHaveText(/^I wrote teh word\. my house\s*$/);
  });

  test('zoom in, out and back to actual size from the View menu', async ({ noted }) => {
    const { app } = await noted.relaunch();
    const level = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
    await clickMenu(app, 'Zoom In');
    await expect.poll(level).toBeGreaterThan(0);
    await clickMenu(app, 'Actual Size');
    await expect.poll(level).toBe(0);
    await clickMenu(app, 'Zoom Out');
    await expect.poll(level).toBeLessThan(0);
  });

  test('going back to a note puts the caret and the scroll where they were', async ({ noted }) => {
    seed(noted.vault, { 'Long.md': `<h1>Long</h1>${lines(80)}`, 'Other.md': '<h1>Other</h1><p>other</p>' });
    const { win } = await noted.relaunch();
    const scroller = win.locator('.overflow-y-auto:has(> div > div [contenteditable="true"])').first();
    await open(win, 'Long');
    const target = win.locator('[contenteditable="true"] p', { hasText: /^Line 60 of/ });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await win.keyboard.press('End');
    const top = await scroller.evaluate(el => el.scrollTop);
    expect(top).toBeGreaterThan(200);

    await open(win, 'Other');
    await open(win, 'Long');
    // The caret is put back a moment after the note shows; typing before that would land on the sidebar row.
    await expect(win.locator('[contenteditable="true"]').first()).toBeFocused();
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(top - 5);
    await win.keyboard.type(' HERE');
    await expect(target).toHaveText('Line 60 of a long note. HERE');
  });

  test('Back and Forward go through the notes opened', async ({ noted }) => {
    seed(noted.vault, { 'Alpha.md': '<h1>Alpha</h1><p>a</p>', 'Beta.md': '<h1>Beta</h1><p>b</p>', 'Gamma.md': '<h1>Gamma</h1><p>c</p>' });
    const { win, app } = await noted.relaunch();
    const title = win.locator('[contenteditable="true"] h1').first();
    await open(win, 'Alpha'); await open(win, 'Beta'); await open(win, 'Gamma');
    await clickMenu(app, 'Back'); await expect(title).toHaveText('Beta');
    await clickMenu(app, 'Back'); await expect(title).toHaveText('Alpha');
    await clickMenu(app, 'Forward'); await expect(title).toHaveText('Beta');
  });

  test('the window reopens with the size and place it was left at', async ({ noted }) => {
    const first = await noted.relaunch();
    // Inside the screen there is (CI runners have small ones): a size larger than the screen is reduced on purpose.
    const area = await first.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    const wanted = {
      x: area.x + 40, y: area.y + 30,
      width: Math.min(1010, area.width - 80), height: Math.max(500, Math.min(690, area.height - 60)),
    };
    await first.app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b), wanted);
    const again = await first.relaunch(); // closing the window saves its place
    const got = await again.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    expect({ width: got.width, height: got.height }).toEqual({ width: wanted.width, height: wanted.height });
    // Linux window managers place windows themselves; the place is checked where the app decides it.
    if (process.platform !== 'linux') expect({ x: got.x, y: got.y }).toEqual({ x: wanted.x, y: wanted.y });
  });

  test('find and replace from the keyboard', async ({ noted }) => {
    seed(noted.vault, { 'Swap.md': '<h1>Swap</h1><p>red, red and red</p>' });
    const { win } = await noted.relaunch();
    await open(win, 'Swap');
    await win.locator('[contenteditable="true"] p').first().click();
    await win.keyboard.press(isMac ? 'Meta+Alt+KeyF' : 'Control+KeyH');
    await win.getByPlaceholder('Find in document...').fill('red');
    await win.getByLabel('Replace with…').fill('blue');
    await win.getByRole('button', { name: 'Replace all' }).click();
    await expect(win.locator('[contenteditable="true"] p').first()).toHaveText('blue, blue and blue');
  });

  test('the find bar keeps its search when another note is opened, and counts in that note', async ({ noted }) => {
    seed(noted.vault, { 'One.md': '<h1>One</h1><p>red red</p>', 'Two.md': '<h1>Two</h1><p>red red red</p>' });
    const { win } = await noted.relaunch();
    await open(win, 'One');
    await win.locator('[contenteditable="true"] p').first().click();
    await win.keyboard.press(`${MOD}+KeyF`);
    await win.getByPlaceholder('Find in document...').fill('red');
    await expect(win.getByText('1/2', { exact: true })).toBeVisible();
    await open(win, 'Two');
    await expect(win.getByText(/^\d+\/3$/)).toBeVisible();
    await expect(win.locator('[contenteditable="true"] .find-match')).toHaveCount(3);
  });

  test('a web link opens on ⌘/Ctrl+click only, and ⌘K links the selected text', async ({ noted }) => {
    seed(noted.vault, { 'Links.md': '<h1>Links</h1><p>See <a href="https://example.com/doc">the docs</a> and the plan.</p>' });
    const { win, app } = await noted.relaunch();
    await open(win, 'Links');
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { opened: string[] };
      g.opened = [];
      shell.openExternal = async (url: string) => { g.opened.push(url); };
    });
    const opened = () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
    const link = win.locator('[contenteditable="true"] a');

    await link.click();
    await win.waitForTimeout(500);
    expect(await opened()).toEqual([]); // a plain click edits
    await link.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
    await expect.poll(opened).toEqual(['https://example.com/doc']);

    // Select "plan" and press ⌘K: the link prompt, not Quick Open.
    const p = win.locator('[contenteditable="true"] p').first();
    await p.click();
    await p.evaluate(el => {
      const text = el.lastChild as Text; // " and the plan."
      const start = text.data.indexOf('plan');
      const r = document.createRange();
      r.setStart(text, start);
      r.setEnd(text, start + 4);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await expect.poll(() => win.evaluate(() => window.getSelection()?.toString())).toBe('plan');
    await win.keyboard.press(`${MOD}+KeyK`);
    const input = win.getByPlaceholder('https://example.com');
    await input.fill('https://example.com/plan');
    await input.press('Enter');
    await expect(win.locator('[contenteditable="true"] a[href="https://example.com/plan"]')).toHaveText('plan');
  });
});
