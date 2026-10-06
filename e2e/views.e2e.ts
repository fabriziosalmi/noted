import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// Saved views (#19-#21, #26): a table over the notes' frontmatter, made, configured and opened from the sidebar, kept in
// a file in the vault, and never changing a note.
const NOTES: Record<string, string> = {
  'Projects/Alpha.md': '---\nstatus: open\nvotes: 3\ntags: [q4, ops]\ndone: true\n---\n# Alpha\n\nfirst\n',
  'Projects/Beta.md': '---\nstatus: draft\nvotes: 12\ntags: [q4]\n---\n# Beta\n\nsecond\n',
  'Journal.md': '# Journal\n\nno properties here\n',
};

test('views: make a table view, point it at a folder, choose columns, open a note from it, delete it', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  for (const [name, text] of Object.entries(NOTES)) {
    fs.mkdirSync(path.dirname(path.join(noted.vault, name)), { recursive: true });
    fs.writeFileSync(path.join(noted.vault, name), text);
  }
  const { win, vault } = await noted.relaunch();
  const viewsFile = path.join(vault, '.noted-views.json');
  const editor = win.locator('[contenteditable="true"]').first();

  // Make one from the sidebar
  await expect(win.getByTestId('views-section')).toBeVisible({ timeout: 15_000 });
  await win.getByRole('button', { name: 'New view' }).click();
  const dialog = win.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Projects board');
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  const page = win.getByTestId('view-page');
  await expect(page.getByRole('heading', { name: 'Projects board' })).toBeVisible();
  await expect(win.getByTestId('view-count')).toHaveText('3 notes', { timeout: 15_000 });
  await expect.poll(() => fs.existsSync(viewsFile), { timeout: 10_000 }).toBe(true);

  // Point it at a folder, and choose columns
  await win.getByRole('button', { name: 'Configure view' }).click();
  const settings = win.getByTestId('view-settings');
  await settings.getByLabel('Source').selectOption('folder');
  const folder = settings.getByRole('combobox', { name: 'Folder' });
  await folder.fill('Projects');
  await folder.blur();
  await expect(win.getByTestId('view-count')).toHaveText('2 notes');

  await settings.getByText('status', { exact: true }).click();
  await settings.getByText('votes', { exact: true }).click();
  await settings.getByText('done', { exact: true }).click();
  const table = win.getByTestId('view-table');
  await expect(table.getByRole('columnheader')).toHaveText(['Name', 'status', 'votes', 'done']);
  const alpha = table.locator('tr[data-row="Projects/Alpha.md"]');
  await expect(alpha.locator('[data-field="status"]')).toHaveText('open');
  await expect(alpha.locator('[data-field="votes"]')).toHaveText('3');
  await expect(alpha.getByRole('img', { name: '✓' })).toBeVisible();

  // Sort by votes: a click, then another
  await table.getByRole('button', { name: 'Sort by votes' }).click();
  await expect(table.getByRole('columnheader', { name: /votes/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.locator('tbody tr').first()).toHaveAttribute('data-row', 'Projects/Alpha.md');
  await table.getByRole('button', { name: 'Sort by votes' }).click();
  await expect(table.locator('tbody tr').first()).toHaveAttribute('data-row', 'Projects/Beta.md');

  // The view is a file in the vault, and no note was changed
  await expect.poll(() => {
    try {
      const saved = JSON.parse(fs.readFileSync(viewsFile, 'utf8')) as { views: { name: string; source: unknown; columns: string[]; sort: unknown }[] };
      return JSON.stringify(saved.views.map(v => [v.name, v.source, v.columns, v.sort]));
    } catch { return ''; }
  }, { timeout: 10_000 }).toBe(JSON.stringify([['Projects board', { kind: 'folder', folder: 'Projects' }, ['status', 'votes', 'done'], [{ field: 'votes', dir: 'desc' }]]]));
  for (const [name, text] of Object.entries(NOTES)) expect(fs.readFileSync(path.join(vault, name), 'utf8')).toBe(text);

  // A name in the table opens the note, and leaves the view
  await table.getByRole('button', { name: 'Alpha' }).click();
  await expect(editor.locator('h1')).toHaveText('Alpha');
  await expect(win.getByTestId('view-page')).toHaveCount(0);

  // ...and the view is still in the sidebar, to come back to
  await win.getByTestId('views-section').getByRole('button', { name: 'Projects board', exact: true }).click();
  await expect(win.getByTestId('view-count')).toHaveText('2 notes');

  // Delete it: the notes stay, the file goes
  await win.getByRole('button', { name: 'Delete view: Projects board' }).click({ force: true });
  await win.getByRole('dialog').getByRole('button', { name: 'Delete view' }).click();
  await expect(win.getByTestId('view-page')).toHaveCount(0);
  await expect.poll(() => fs.existsSync(viewsFile), { timeout: 10_000 }).toBe(false);
  for (const name of Object.keys(NOTES)) expect(fs.existsSync(path.join(vault, name))).toBe(true);
});
