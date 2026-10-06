import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// The Properties panel (#66): the open note's frontmatter, edited in place by type, a link property that opens its note and
// counts as a backlink, and a note's text kept exactly except for the property.
const TASK = '---\n# who is on it\nparent: "[[Home]]"\nstatus: "open"   # keep\n---\n# Task\n\nbody  with   spacing\n';

test('properties: edit by type, add a typed property, follow a link property that is also a backlink', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Home.md'), '# Home\n\nthe start\n');
  fs.writeFileSync(path.join(noted.vault, 'Task.md'), TASK);
  const { win, vault } = await noted.relaunch();
  const file = path.join(vault, 'Task.md');
  const editor = win.locator('[contenteditable="true"]').first();

  await win.getByRole('button', { name: /^Task/ }).first().click();
  await expect(editor.locator('h1')).toHaveText('Task');
  await win.getByRole('button', { name: 'Toggle right panel' }).click();
  await win.getByRole('tab', { name: 'Properties' }).click();
  const panel = win.getByTestId('properties-panel');
  await expect(panel.locator('[data-property="status"]')).toContainText('open');
  await expect(panel.locator('[data-property="parent"]').getByRole('button', { name: 'Home' })).toBeVisible();

  // Edit a text property: only that value changes in the file (quotes and the comment stay)
  const status = panel.locator('[data-property="status"] [data-field="status"]');
  await status.dblclick();
  const input = panel.getByLabel('status', { exact: true }).and(win.locator('input'));
  await input.fill('done');
  await input.press('Enter');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(TASK.replace('"open"   # keep', '"done"   # keep'));

  // Add a number property and give it a value: it is a number in the file, not text
  await panel.getByLabel('Property name').fill('rating');
  await panel.getByLabel('Type').selectOption('number');
  await panel.getByRole('button', { name: 'Add property' }).click();
  await expect(panel.locator('[data-property="rating"]')).toBeVisible({ timeout: 15_000 });
  await panel.locator('[data-property="rating"] [data-field="rating"]').dblclick();
  const rating = panel.getByLabel('rating', { exact: true }).and(win.locator('input'));
  await rating.fill('7');
  await rating.press('Enter');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('rating: 7\n');

  // A checkbox property toggles
  await panel.getByLabel('Property name').fill('reviewed');
  await panel.getByLabel('Type').selectOption('checkbox');
  await panel.getByRole('button', { name: 'Add property' }).click();
  await panel.locator('[data-property="reviewed"]').getByRole('checkbox').click();
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('reviewed: true\n');

  // The body is what it was
  expect(fs.readFileSync(file, 'utf8').endsWith('---\n# Task\n\nbody  with   spacing\n')).toBe(true);

  // Remove a property
  await panel.getByRole('button', { name: 'Remove property: rating' }).click({ force: true });
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).not.toContain('rating');

  // The link property opens its note, and Task is one of Home's backlinks because of it
  await panel.locator('[data-property="parent"]').getByRole('button', { name: 'Home' }).click();
  await expect(editor.locator('h1')).toHaveText('Home');
  await win.getByRole('tab', { name: 'Connections' }).click();
  await expect(win.getByRole('button', { name: /^Task/ }).last()).toBeVisible({ timeout: 15_000 });
});
