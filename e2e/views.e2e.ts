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
  await expect(alpha.getByRole('checkbox', { name: 'done' })).toBeChecked();

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

test('views: filter and sort from the panel, the count follows, and nothing is hidden by an unfinished filter', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  for (const [name, text] of Object.entries(NOTES)) {
    fs.mkdirSync(path.dirname(path.join(noted.vault, name)), { recursive: true });
    fs.writeFileSync(path.join(noted.vault, name), text);
  }
  const { win, vault } = await noted.relaunch();
  await expect(win.getByTestId('views-section')).toBeVisible({ timeout: 15_000 });
  await win.getByRole('button', { name: 'New view' }).click();
  await win.getByRole('dialog').getByRole('textbox').fill('Open work');
  await win.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  const count = win.getByTestId('view-count');
  await expect(count).toHaveText('3 notes', { timeout: 15_000 });

  await win.getByRole('button', { name: 'Filter & sort' }).click();
  const query = win.getByTestId('view-query');

  // A new filter has no value yet, so it hides nothing
  await query.getByRole('button', { name: 'Add filter' }).click();
  await expect(count).toHaveText('3 notes');
  await expect(win.getByTestId('view-query-count')).toHaveText('1');
  const filter = query.locator('[data-filter="0"]');
  await expect(filter.getByLabel('Field')).toHaveValue('status');
  await filter.getByLabel('Value').selectOption('open');
  await expect(count).toHaveText('1 notes');
  await expect(win.getByTestId('view-table').locator('tbody tr')).toHaveAttribute('data-row', 'Projects/Alpha.md');

  // "is not" keeps the notes that are not open, including the one with no status at all
  await filter.getByRole('combobox').nth(1).selectOption('not-equals');
  await expect(count).toHaveText('2 notes');

  // Sort by votes, biggest first: the note with no votes stays last
  await filter.getByRole('button', { name: 'Remove' }).click();
  await expect(count).toHaveText('3 notes');
  await query.getByRole('button', { name: 'Add sort' }).click();
  const sort = query.locator('[data-sort="0"]');
  await sort.getByLabel('Field').selectOption('votes');
  await sort.getByRole('combobox').nth(1).selectOption('desc');
  await expect.poll(async () => win.getByTestId('view-table').locator('tbody tr').evaluateAll(rows => rows.map(r => r.getAttribute('data-row'))))
    .toEqual(['Projects/Beta.md', 'Projects/Alpha.md', 'Journal.md']);

  const viewsFile = path.join(vault, '.noted-views.json');
  await expect.poll(() => {
    try { return JSON.stringify((JSON.parse(fs.readFileSync(viewsFile, 'utf8')) as { views: { filters: unknown; sort: unknown }[] }).views.map(v => [v.filters, v.sort])); } catch { return ''; }
  }, { timeout: 10_000 }).toBe(JSON.stringify([[[], [{ field: 'votes', dir: 'desc' }]]]));
});

test('views: editing a cell changes that property in the note file and nothing else, and the table follows edits made elsewhere', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  const original = '---\n# who owns it\nstatus: "open"   # keep this\nvotes: 3\ntags: [q4, ops]\ndone: true\n---\n# Alpha\n\nfirst  text   with spacing\n';
  fs.mkdirSync(path.join(noted.vault, 'Projects'));
  fs.writeFileSync(path.join(noted.vault, 'Projects', 'Alpha.md'), original);
  fs.writeFileSync(path.join(noted.vault, 'Projects', 'Beta.md'), '---\nstatus: draft\nvotes: 12\n---\n# Beta\n');
  // A view made by hand (or by a sync) is picked up as it is
  fs.writeFileSync(path.join(noted.vault, '.noted-views.json'), JSON.stringify({ version: 1, views: [{
    id: 'v-hand', name: 'Grid', layout: 'table', source: { kind: 'folder', folder: 'Projects' }, filters: [], sort: [{ field: '$name', dir: 'asc' }], columns: ['status', 'votes', 'tags', 'done'],
  }] }));
  const { win, vault } = await noted.relaunch();
  const file = path.join(vault, 'Projects', 'Alpha.md');
  await win.getByTestId('views-section').getByRole('button', { name: 'Grid', exact: true }).click({ timeout: 15_000 });
  const alpha = win.locator('tr[data-row="Projects/Alpha.md"]');
  await expect(alpha.locator('[data-field="status"]')).toHaveText('open', { timeout: 15_000 });

  const edit = async (field: string, text: string) => {
    await alpha.locator(`[data-field="${field}"]`).dblclick();
    const input = win.getByLabel(field, { exact: true }).and(win.locator('input'));
    await input.fill(text);
    await input.press('Enter');
  };

  await edit('status', 'closed');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(original.replace('"open"   # keep this', '"closed"   # keep this'));
  await expect(alpha.locator('[data-field="status"]')).toHaveText('closed');

  await edit('votes', '5');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('votes: 5\n');
  await edit('tags', 'q4, ops, new');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('tags: [q4, ops, new]\n');
  await alpha.getByRole('checkbox', { name: 'done' }).click();
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('done: false\n');

  // Everything else in the file is what it was, byte for byte
  expect(fs.readFileSync(file, 'utf8')).toBe(
    '---\n# who owns it\nstatus: "closed"   # keep this\nvotes: 5\ntags: [q4, ops, new]\ndone: false\n---\n# Alpha\n\nfirst  text   with spacing\n',
  );

  // A cleared cell removes the property
  await edit('votes', '');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).not.toContain('votes');

  // Every change kept the version before it
  await expect.poll(() => fs.existsSync(path.join(vault, '.noted_history', 'Projects', 'Alpha.md')), { timeout: 10_000 }).toBe(true);

  // An edit made outside the app shows in the table
  const beta = win.locator('tr[data-row="Projects/Beta.md"]');
  fs.writeFileSync(path.join(vault, 'Projects', 'Beta.md'), '---\nstatus: draft\nvotes: 99\n---\n# Beta\n');
  await expect(beta.locator('[data-field="votes"]')).toHaveText('99', { timeout: 20_000 });
});
