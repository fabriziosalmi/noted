import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// Unlinked mentions (#69): notes that write this note's name as plain text, and one click to link them.
const NOTES: Record<string, string> = {
  'Quarterly Plan.md': '---\naliases: [Roadmap]\n---\n# Quarterly Plan\n\nthe plan\n',
  'Meeting.md': '# Meeting\n\nWe went over the Quarterly plan and the Roadmap, then `Quarterly Plan` in code.\n',
  'Linked.md': '# Linked\n\nAlready [[Quarterly Plan]] here, and the Quarterly Plan in prose.\n',
  'Elsewhere/Notes.md': '# Notes\n\nNothing relevant, just plans.\n',
};

test('unlinked mentions: listed with context, linked in one click, then they are backlinks', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  for (const [name, text] of Object.entries(NOTES)) {
    fs.mkdirSync(path.dirname(path.join(noted.vault, name)), { recursive: true });
    fs.writeFileSync(path.join(noted.vault, name), text);
  }
  const { win, vault } = await noted.relaunch();

  await win.getByRole('button', { name: /^Quarterly Plan/ }).first().click();
  await expect(win.locator('[contenteditable="true"]').first().locator('h1')).toHaveText('Quarterly Plan');
  await win.getByRole('button', { name: 'Toggle right panel' }).click();
  await win.getByRole('tab', { name: 'Connections' }).click();

  const section = win.getByTestId('unlinked-mentions');
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section.locator('[data-mention]')).toHaveCount(1); // Meeting only: Linked already links, the code mention is not one
  await expect(section.locator('[data-mention="Meeting.md"]')).toContainText('We went over the');
  await expect(section.locator('[data-mention="Meeting.md"] mark')).toHaveText('Quarterly plan');
  await expect(section.locator('[data-mention="Meeting.md"]')).toContainText('2 mentions'); // the title and the alias

  await section.getByRole('button', { name: 'Link: Meeting' }).click();
  await expect.poll(() => fs.readFileSync(path.join(vault, 'Meeting.md'), 'utf8'), { timeout: 15_000 })
    .toContain('We went over the [[Quarterly Plan|Quarterly plan]] and the Roadmap');
  expect(fs.readFileSync(path.join(vault, 'Meeting.md'), 'utf8')).toContain('`Quarterly Plan` in code'); // code untouched

  // The note links to this one now, so it is a backlink, not a mention (the alias written elsewhere in it stays text)
  await expect(win.getByTestId('unlinked-mentions')).toHaveCount(0, { timeout: 15_000 });
  await expect(win.getByRole('button', { name: 'Meeting', exact: true }).first()).toBeVisible();
  expect(fs.readFileSync(path.join(vault, 'Meeting.md'), 'utf8')).toContain('and the Roadmap, then');
  // the change kept the earlier text in the note's history
  expect(fs.readdirSync(path.join(vault, '.noted_history', 'Meeting.md'))).toHaveLength(1);
});
