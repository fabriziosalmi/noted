import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';
import { appendEntry, journalDir } from '../shared/vault/journalFile';

// The agent journal (#84): what assistants changed, shown by session, undone one by one or all at once, and the chain checked.
// The entries are written the way the MCP server writes them (its own tests cover that with a real vault).
const SESSION = 'sess-claude';

test('agent activity: sessions, differences, undo one, undo a session, a note changed since refuses, a tampered journal is shown', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  const v = noted.vault;
  const base = { client: 'claude-code', session: SESSION, via: 'direct' as const };
  const put = (name: string, text: string | null) => { if (text === null) fs.rmSync(path.join(v, name), { force: true }); else { fs.mkdirSync(path.dirname(path.join(v, name)), { recursive: true }); fs.writeFileSync(path.join(v, name), text); } };

  // Plan: an agent changed it twice. Idea: an agent made it. Old: an agent deleted it. Edited: changed by an agent, then by a person.
  put('Plan.md', '# Plan\n\nquarterly roadmap\n');
  appendEntry(v, { ...base, tool: 'edit_note', kind: 'update', note: 'Plan.md', before: '# Plan\n\nquarterly roadmap\n', after: '# Plan\n\nyearly roadmap\n' });
  put('Plan.md', '# Plan\n\nyearly roadmap\n');
  appendEntry(v, { ...base, tool: 'update_note', kind: 'update', note: 'Plan.md', before: '# Plan\n\nyearly roadmap\n', after: '# Plan\n\nyearly roadmap, revised\n' });
  put('Plan.md', '# Plan\n\nyearly roadmap, revised\n');
  appendEntry(v, { ...base, tool: 'create_note', kind: 'create', note: 'Idea.md', before: null, after: '# Idea\n\nfrom an agent\n' });
  put('Idea.md', '# Idea\n\nfrom an agent\n');
  appendEntry(v, { ...base, tool: 'delete_note', kind: 'delete', note: 'Old.md', before: '# Old\n\nprecious\n', after: null });
  appendEntry(v, { ...base, tool: 'update_note', kind: 'update', note: 'Edited.md', before: '# Edited\n\nv0\n', after: '# Edited\n\nagent v1\n' });
  put('Edited.md', '# Edited\n\na person wrote this after\n');

  const { win } = await noted.relaunch();
  await win.getByTestId('views-section').getByRole('button', { name: 'Agent activity' }).click({ timeout: 20_000 });
  const page = win.getByTestId('activity-page');
  await expect(page.getByTestId('activity-chain')).toContainText('5 entries, the chain is intact', { timeout: 15_000 });
  await expect(page.locator('[data-session]')).toHaveCount(1);
  await expect(page.locator('[data-session]')).toContainText('claude-code');
  await expect(page.locator('[data-entry]')).toHaveCount(5);

  // The difference of a change
  const entryFor = (note: string, tool: string) => page.locator('[data-entry]').filter({ hasText: note }).filter({ hasText: tool });
  const edit = entryFor('Plan', 'edit_note');
  await edit.getByRole('button', { name: 'Show changes' }).click();
  await expect(edit.locator('mark')).toContainText(['quarterly', 'yearly']);

  // Filter by note
  await page.getByLabel('Filter by note').fill('idea');
  await expect(page.locator('[data-entry]')).toHaveCount(1);
  await page.getByLabel('Filter by note').fill('');

  // A change that came after is undone first: Plan's second change, then its first
  await entryFor('Plan', 'update_note').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.readFileSync(path.join(v, 'Plan.md'), 'utf8'), { timeout: 15_000 }).toBe('# Plan\n\nyearly roadmap\n');
  await expect(entryFor('Plan', 'update_note').getByText('undone', { exact: true })).toBeVisible();

  // A note a person changed after the agent: undo is refused and nothing is overwritten
  await entryFor('Edited', 'update_note').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/Not undone: the note was changed after/)).toBeVisible();
  expect(fs.readFileSync(path.join(v, 'Edited.md'), 'utf8')).toBe('# Edited\n\na person wrote this after\n');

  // The rest of the session in one go: what can be undone is (the edit, the creation, the deletion); the changed note stays
  await page.getByRole('button', { name: 'Undo this session' }).click();
  await expect.poll(() => fs.readFileSync(path.join(v, 'Plan.md'), 'utf8'), { timeout: 15_000 }).toBe('# Plan\n\nquarterly roadmap\n');
  await expect.poll(() => fs.existsSync(path.join(v, 'Idea.md')), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => fs.existsSync(path.join(v, 'Old.md')), { timeout: 15_000 }).toBe(true);
  expect(fs.readFileSync(path.join(v, 'Old.md'), 'utf8')).toBe('# Old\n\nprecious\n');
  expect(fs.readFileSync(path.join(v, 'Edited.md'), 'utf8')).toBe('# Edited\n\na person wrote this after\n');
  await expect(page.getByTestId('activity-chain')).toContainText('the chain is intact'); // the undos are on the record too, and the chain still holds

  // The journal edited behind the app's back is shown, and where
  const file = path.join(journalDir(v), fs.readdirSync(journalDir(v)).find(f => f.endsWith('.jsonl'))!);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  lines[1] = lines[1].replace('Plan.md', 'Other.md');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  await win.getByRole('button', { name: 'Back to the note' }).click();
  await win.getByTestId('views-section').getByRole('button', { name: 'Agent activity' }).click();
  await expect(win.getByTestId('activity-chain')).toContainText('The journal was changed after it was written: entry 2', { timeout: 15_000 });
});
