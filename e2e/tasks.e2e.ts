import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// The vault-wide Tasks page (#71): the tasks of every note, filtered, and ticked from the page into the note itself.
const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test('tasks: every note\'s tasks in one list, filtered, ticked into the note, with the note otherwise untouched', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.mkdirSync(path.join(noted.vault, 'Work'));
  fs.mkdirSync(path.join(noted.vault, 'Home'));
  const plan = `---\ntitle: Plan\n---\n# Plan\n\n- [ ] draft the plan 📅 ${day(-2)}\n- [x] outline\n- [ ] review due:: ${day(3)}\n\nbody  with   spacing\n`;
  const chores = `- [ ] buy milk\n- [ ] call the plumber 📅 ${day(0)} #urgent\n`;
  fs.writeFileSync(path.join(noted.vault, 'Work', 'Plan.md'), plan);
  fs.writeFileSync(path.join(noted.vault, 'Home', 'Chores.md'), chores);
  fs.writeFileSync(path.join(noted.vault, 'Journal.md'), '# Journal\n\nno tasks\n');
  const { win, vault } = await noted.relaunch();
  const editor = win.locator('[contenteditable="true"]').first();

  await win.getByTestId('views-section').getByRole('button', { name: 'Tasks', exact: true }).click({ timeout: 15_000 });
  const page = win.getByTestId('tasks-page');
  const order = () => page.locator('[data-task]').evaluateAll(els => els.map(e => e.getAttribute('data-task')));

  // Open tasks, soonest due first, those with no date last
  await expect.poll(order, { timeout: 15_000 }).toEqual(['Work/Plan.md:6', 'Home/Chores.md:2', 'Work/Plan.md:8', 'Home/Chores.md:1']);
  await expect(win.getByTestId('tasks-count')).toHaveText('4 tasks');
  await expect(page.locator('[data-task="Work/Plan.md:6"] [data-due]')).toContainText('overdue');
  await expect(page.locator('[data-task="Work/Plan.md:8"] [data-due]')).not.toContainText('overdue');

  // Filters
  await page.getByLabel('Folder').fill('Home');
  await expect.poll(order).toEqual(['Home/Chores.md:2', 'Home/Chores.md:1']);
  await page.getByLabel('Folder').fill('');
  await page.getByLabel('Due').selectOption('overdue');
  await expect.poll(order).toEqual(['Work/Plan.md:6']);
  await page.getByLabel('Due').selectOption('any');
  await page.getByLabel('Tag').fill('#urgent');
  await expect.poll(order).toEqual(['Home/Chores.md:2']);
  await page.getByLabel('Tag').fill('');
  await page.getByLabel('Status').selectOption('done');
  await expect.poll(order).toEqual(['Work/Plan.md:7']);
  await page.getByLabel('Status').selectOption('open');
  await expect.poll(order).toHaveLength(4);

  // Tick a task: it changes in its note, one character, the rest as it was
  await page.getByRole('checkbox', { name: 'draft the plan' }).click();
  await expect.poll(() => fs.readFileSync(path.join(vault, 'Work', 'Plan.md'), 'utf8'), { timeout: 15_000 }).toBe(plan.replace('- [ ] draft the plan', '- [x] draft the plan'));
  await expect(win.getByTestId('tasks-count')).toHaveText('3 tasks', { timeout: 15_000 });
  await expect.poll(order).toEqual(['Home/Chores.md:2', 'Work/Plan.md:8', 'Home/Chores.md:1']);
  expect(fs.readFileSync(path.join(vault, 'Home', 'Chores.md'), 'utf8')).toBe(chores);
  expect(fs.existsSync(path.join(vault, '.noted_history', 'Work', 'Plan.md'))).toBe(true);

  // A task done in a note while the page is open shows up
  fs.writeFileSync(path.join(vault, 'Home', 'Chores.md'), chores.replace('- [ ] buy milk', '- [x] buy milk'));
  await expect.poll(order, { timeout: 20_000 }).toEqual(['Home/Chores.md:2', 'Work/Plan.md:8']);

  // The note name opens the note
  await page.locator('[data-task="Work/Plan.md:8"]').getByRole('button', { name: 'Work/Plan' }).click();
  await expect(editor.locator('h1')).toHaveText('Plan');
  await expect(win.getByTestId('tasks-page')).toHaveCount(0);
});
