import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, SEED_NOTES } from './fixtures';

// Opening an Obsidian vault where it is (#62): nothing in it is rewritten, renamed or added until the user
// edits a note, and then only that note changes. Links resolve the way Obsidian resolves them.
const MOD = 'ControlOrMeta';

// Deliberately not what Noted would write: padded tables, "*" bullets, CRLF frontmatter with a comment, a
// note whose H1 is not its file name, an HTML block first, wikilinks by bare name into a folder.
const NOTES: Record<string, string> = {
  'Home.md': '---\r\ntitle: Home   # keep my spacing\r\naliases: [Start]\r\n---\r\n# Welcome home\r\n\r\n* go to [[Garden]]\r\n* and [[Work/Plan|the plan]]\r\n* and [[plan]] #hub\r\n\r\n| a   | b   |\r\n|-----|-----|\r\n| 1   | 2   |\r\n',
  'Life/Garden.md': '<kbd>Ctrl</kbd> opens the shed\n\n# Garden notes\n\nSee [[Home]].\n',
  'Work/Plan.md': '# Q4 roadmap\n\nBack to [[Home]] and [[Garden]].\n',
  'Work/Notes.md': 'Meeting notes, see [[Plan]].\n',
};
const IGNORED: Record<string, string> = {
  '.obsidian/app.json': '{"attachmentFolderPath":"Pasted images"}',
  '.obsidian/workspace.json': '{"main":{"id":"x"}}',
  '.trash/Deleted note.md': '# Deleted in Obsidian\n',
};
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR4nGP8z8Dwn4EIAAA+EAH/4jNf1AAAAABJRU5ErkJggg==';

const row = (win: Page, name: string) => win.getByRole('button', { name: new RegExp(`^${name}`) }).first();

const tree = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = `${crypto.createHash('sha1').update(fs.readFileSync(path.join(root, r))).digest('hex')}@${fs.statSync(path.join(root, r)).mtimeMs}`;
    }
  };
  walk('');
  return out;
};

async function obsidianVault(noted: Parameters<Parameters<typeof test>[2]>[0]['noted']) {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  for (const [name, text] of Object.entries({ ...NOTES, ...IGNORED })) {
    fs.mkdirSync(path.dirname(path.join(noted.vault, name)), { recursive: true });
    fs.writeFileSync(path.join(noted.vault, name), text);
  }
  const past = new Date(Date.now() - 86_400_000); // so an unwanted rewrite changes the time visibly
  for (const name of Object.keys({ ...NOTES, ...IGNORED })) fs.utimesSync(path.join(noted.vault, name), past, past);
  return noted.relaunch();
}

test.describe('an Obsidian vault opened in place', () => {
  test('is read as Markdown, shows its notes, and opening them writes nothing', async ({ noted }) => {
    const { win, vault } = await obsidianVault(noted);
    const before = tree(vault);

    // The list: the vault's notes, none of Obsidian's own files.
    await expect(win.getByText('Home', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(win.getByText('Deleted note')).toHaveCount(0);

    // Open every note (and a few times over): no save is triggered by looking.
    const editor = win.locator('[contenteditable="true"]').first();
    await win.getByText('Home', { exact: true }).first().click();
    await expect(editor.locator('h1')).toHaveText('Welcome home');
    await expect(editor.locator('table')).toHaveCount(1);
    await row(win, 'Garden').click();
    await expect(editor.locator('h1')).toHaveText('Garden notes');
    await row(win, 'Plan').click();
    await expect(editor.locator('h1')).toHaveText('Q4 roadmap');
    await row(win, 'Notes').click();
    await expect(editor).toContainText('Meeting notes');
    await win.waitForTimeout(2500); // longer than any autosave or title-sync delay

    expect(tree(vault)).toEqual(before); // same bytes, same times, no new file anywhere
    expect(fs.existsSync(path.join(vault, '.noted-vault.json'))).toBe(false);
  });

  test('links resolve like Obsidian: a bare name finds a note in a folder, and backlinks agree', async ({ noted }) => {
    const { win } = await obsidianVault(noted);
    await row(win, 'Plan').click();
    await expect(win.locator('[contenteditable="true"]').first().locator('h1')).toHaveText('Q4 roadmap');

    // Home links to it as [[Work/Plan|the plan]] and [[plan]]; Work/Notes.md as [[Plan]]: both are backlinks.
    await expect(win.getByRole('button', { name: '[[Home]]' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(win.getByRole('button', { name: /^\[\[(Work\/)?Notes\]\]$/ }).first()).toBeVisible();
  });

  test('following a link to a note in a folder opens it, and does not create a new note', async ({ noted }) => {
    const { win, vault } = await obsidianVault(noted);
    await win.getByText('Home', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Welcome home');
    await editor.locator('[data-wikilink="Garden"]').first().click();
    await expect(editor.locator('h1')).toHaveText('Garden notes');
    expect(fs.existsSync(path.join(vault, 'Garden.md'))).toBe(false);
  });

  test('editing one note changes only that note; its file name and the others stay', async ({ noted }) => {
    const { win, vault } = await obsidianVault(noted);
    const before = tree(vault);
    await row(win, 'Plan').click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Q4 roadmap');
    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' Edited.');
    await expect.poll(() => fs.readFileSync(path.join(vault, 'Work/Plan.md'), 'utf8'), { timeout: 15_000 }).toContain('Edited.');
    await win.waitForTimeout(2500); // title sync would have fired by now

    const after = tree(vault);
    const changed = Object.keys(after).filter(f => after[f] !== before[f]);
    // The note, and its previous text in the note's history (hidden, as the app does for every edit); no rename, nothing else.
    expect(changed.filter(f => !f.startsWith('.noted_history/'))).toEqual(['Work/Plan.md']);
    expect(fs.readFileSync(path.join(vault, 'Work/Plan.md'), 'utf8')).toBe('# Q4 roadmap\n\nBack to [[Home]] and [[Garden]]. Edited.\n');
  });

  test('a pasted image goes where Obsidian keeps its own', async ({ noted }) => {
    const { win, vault } = await obsidianVault(noted);
    const res = await win.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return (window as unknown as { electronAPI: { saveAttachment(b: Uint8Array, folder: string): Promise<unknown> } }).electronAPI.saveAttachment(bytes, 'attachments');
    }, PNG_B64) as { success: boolean; data?: string };
    expect(res.success).toBe(true);
    expect(res.data).toMatch(/^Pasted images\/[0-9a-f]{32}\.png$/);
    expect(fs.existsSync(path.join(vault, res.data!))).toBe(true);
  });
});
