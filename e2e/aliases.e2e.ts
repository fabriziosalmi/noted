import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// A note's frontmatter `aliases:` are other names it answers to (#68): a [[link]] by one finds it, it counts as a
// backlink, and Quick Open matches it. Obsidian-compatible, on the real app.
const NOTES: Record<string, string> = {
  'Home.md': '---\ntitle: Home\naliases:\n  - Start\n  - Landing page\n---\n# Home\n\nwelcome\n',
  'Notes/Reader.md': '# Reader\n\ngo to [[Start]] or [[Landing page]] or [[Nowhere]]\n',
};

test('aliases: a link by an alias opens the note, is its backlink, and Quick Open finds it', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  for (const [name, text] of Object.entries(NOTES)) {
    fs.mkdirSync(path.dirname(path.join(noted.vault, name)), { recursive: true });
    fs.writeFileSync(path.join(noted.vault, name), text);
  }
  const { win, vault } = await noted.relaunch();
  const editor = win.locator('[contenteditable="true"]').first();

  // Home is linked from Reader, by two of its aliases
  await win.getByRole('button', { name: /^Home/ }).first().click();
  await expect(editor.locator('h1')).toHaveText('Home');
  await expect(win.getByRole('button', { name: /^\[\[(Notes\/)?Reader\]\]$/ }).first()).toBeVisible({ timeout: 15_000 });

  // Following an alias link opens the note, and makes no new note
  await win.getByRole('button', { name: /^Reader/ }).first().click();
  await expect(editor.locator('h1')).toHaveText('Reader');
  await editor.locator('[data-wikilink="Start"]').first().click();
  await expect(editor.locator('h1')).toHaveText('Home');
  expect(fs.existsSync(path.join(vault, 'Start.md'))).toBe(false);

  // Quick Open by an alias
  await win.keyboard.press('ControlOrMeta+KeyK');
  await win.getByPlaceholder(/open note/i).fill('landing');
  await expect(win.getByTestId('quick-open-alias')).toContainText('Landing page');
  await expect(win.getByRole('button', { name: /Home/ }).filter({ has: win.getByTestId('quick-open-alias') })).toBeVisible();
});
