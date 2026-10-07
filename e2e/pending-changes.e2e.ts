import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';
import { addPending } from '../shared/vault/pendingFile';
import { etagOf } from '../shared/vault/etag';

// Staged writes (#85): what an agent proposed where its writes need approval appears in the app, and approving makes the
// change in the note, rejecting drops it, and a note changed since refuses it. The MCP side is covered with a real vault in
// mcp-server/staged.test.ts; here the files it leaves are placed the way it places them.
test('pending changes: a badge, a review, approve makes the change, reject drops it, a stale one is refused', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.mkdirSync(path.join(noted.vault, 'drafts'));
  const plan = '# Plan\n\nquarterly roadmap\n\nkeep  this   spacing\n';
  const other = '# Other\n\nunchanged\n';
  fs.writeFileSync(path.join(noted.vault, 'drafts', 'Plan.md'), plan);
  fs.writeFileSync(path.join(noted.vault, 'drafts', 'Other.md'), other);
  fs.writeFileSync(path.join(noted.vault, 'Stale.md'), '# Stale\n\nold\n');
  const { win, vault } = await noted.relaunch();

  // Nothing waits: no badge
  await expect(win.getByTestId('pending-badge')).toHaveCount(0);

  const edit = addPending(vault, { client: 'claude-code', tool: 'edit_note', kind: 'update', note: 'drafts/Plan.md', baseEtag: etagOf(plan), before: plan, after: plan.replace('quarterly', 'yearly') });
  const made = addPending(vault, { client: 'claude-code', tool: 'create_note', kind: 'create', note: 'drafts/Fresh.md', baseEtag: null, before: null, after: '# Fresh\n\nfrom an agent\n' });
  const dropped = addPending(vault, { client: 'claude-code', tool: 'delete_note', kind: 'delete', note: 'drafts/Other.md', baseEtag: etagOf(other), before: other, after: null });
  const stale = addPending(vault, { client: 'claude-code', tool: 'update_note', kind: 'update', note: 'Stale.md', baseEtag: etagOf('# Stale\n\nold\n'), before: '# Stale\n\nold\n', after: '# Stale\n\nnew\n' });
  fs.writeFileSync(path.join(vault, 'Stale.md'), '# Stale\n\nedited by a person meanwhile\n'); // so approving it must be refused

  const badge = win.getByTestId('pending-badge');
  await expect(badge).toBeVisible({ timeout: 20_000 });
  await expect(badge).toHaveText('4');
  await badge.click();
  const list = win.getByTestId('pending-list');
  const item = (id: string) => list.locator(`[data-pending="${id}"]`);
  await expect(item(edit.id)).toContainText('yearly');
  await expect(item(edit.id)).toContainText('claude-code');

  // Nothing has been changed yet
  expect(fs.readFileSync(path.join(vault, 'drafts', 'Plan.md'), 'utf8')).toBe(plan);
  expect(fs.existsSync(path.join(vault, 'drafts', 'Fresh.md'))).toBe(false);

  // Approve an edit: that change only, the rest of the note as it was; the version before is kept
  await item(edit.id).getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => fs.readFileSync(path.join(vault, 'drafts', 'Plan.md'), 'utf8'), { timeout: 15_000 }).toBe(plan.replace('quarterly', 'yearly'));
  expect(fs.existsSync(path.join(vault, '.noted_history', 'drafts', 'Plan.md'))).toBe(true);
  await expect(item(edit.id)).toHaveCount(0);

  // Approve a new note
  await item(made.id).getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => fs.existsSync(path.join(vault, 'drafts', 'Fresh.md')), { timeout: 15_000 }).toBe(true);
  expect(fs.readFileSync(path.join(vault, 'drafts', 'Fresh.md'), 'utf8')).toBe('# Fresh\n\nfrom an agent\n');

  // Reject a deletion: the note stays
  await item(dropped.id).getByRole('button', { name: 'Reject' }).click();
  await expect(item(dropped.id)).toHaveCount(0);
  expect(fs.readFileSync(path.join(vault, 'drafts', 'Other.md'), 'utf8')).toBe(other);

  // A change to a note that was edited since is refused, nothing is overwritten, and it can be rejected
  await item(stale.id).getByRole('button', { name: 'Approve' }).click();
  await expect(item(stale.id).getByRole('alert')).toContainText('cannot be applied');
  expect(fs.readFileSync(path.join(vault, 'Stale.md'), 'utf8')).toBe('# Stale\n\nedited by a person meanwhile\n');
  await item(stale.id).getByRole('button', { name: 'Reject' }).click();
  await expect(win.getByText('Nothing is waiting for approval.')).toBeVisible();
  expect(fs.existsSync(path.join(vault, '.noted', 'pending')) ? fs.readdirSync(path.join(vault, '.noted', 'pending')) : []).toEqual([]);
});
