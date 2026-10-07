import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, SEED_NOTES } from './fixtures';
import { addPending } from '../shared/vault/pendingFile';
import { etagOf } from '../shared/vault/etag';

// Reviewable changes (#76): a rewrite by the model, and a change proposed by an agent, are read as a list of changes, each kept or
// dropped on its own, and only what is kept is written.
const NOTE = '# Notes\n\nThe first paragraph is fine.\n\nThe second one is wordy and long.\n\nThe third is wordy too.\n';

test('AI edit review: the rewrite is read before it replaces anything, a change can be dropped, and only the kept ones are applied', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Notes.md'), NOTE);

  // The model shortens: every "wordy and long" and "wordy too" becomes "brief"
  const server = http.createServer((req, res) => {
    if (!req.url?.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const user = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages.find(m => m.role === 'user')?.content ?? '';
      const out = user.replace('is wordy and long', 'is brief').replace('is wordy too', 'is brief too');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const { win, vault } = await noted.relaunch();
    await win.addInitScript(p => {
      const raw = localStorage.getItem('noted-storage');
      const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
      j.state = j.state || {};
      j.state.settings = { ...(j.state.settings || {}), language: 'en', llmProvider: 'lmstudio', lmStudioUrl: `http://127.0.0.1:${p}/v1`, llmModel: 'fake', piiMasking: false, showAiBar: true };
      localStorage.setItem('noted-storage', JSON.stringify(j));
    }, port);
    await win.reload();
    await win.getByRole('button', { name: /^Notes/ }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Notes');

    // Select the two paragraphs to rewrite, and ask for a shorter version
    await editor.getByText('The second one is wordy and long.').click();
    await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await win.getByLabel('Shorten').click();

    const dialog = win.getByRole('dialog');
    await expect(dialog).toContainText('Shorten: review the edit', { timeout: 20_000 });
    await expect(dialog.locator('[data-change]')).toHaveCount(2);
    await expect(win.getByTestId('review-count')).toHaveText('2 of 2 changes kept');
    // Nothing has been replaced while it is read
    await expect(editor).toContainText('wordy and long');
    await expect(editor).toContainText('wordy too');

    // Keep the first change, drop the second
    await dialog.locator('[data-change="1"]').getByRole('button', { name: 'Drop' }).click();
    await expect(win.getByTestId('review-count')).toHaveText('1 of 2 changes kept');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(editor).toContainText('The second one is brief.');
    await expect(editor).toContainText('The third is wordy too.');
    await expect(editor).not.toContainText('wordy and long');
    await expect.poll(() => fs.readFileSync(path.join(vault, 'Notes.md'), 'utf8'), { timeout: 15_000 }).toContain('The second one is brief.');
    expect(fs.readFileSync(path.join(vault, 'Notes.md'), 'utf8')).toContain('The third is wordy too.');

    // Discarding changes nothing: the third paragraph is still as it was
    await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await win.getByLabel('Shorten').click();
    await expect(win.getByRole('dialog')).toContainText('review the edit', { timeout: 20_000 });
    await expect(win.getByRole('dialog').locator('[data-change]')).toHaveCount(1); // only the third paragraph is left to shorten
    await win.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(win.getByRole('dialog')).toHaveCount(0);
    await expect(editor).toContainText('The third is wordy too.');
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test('agent changes: approving part of a change writes the note with only the kept changes made', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  const lines = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`).join('\n');
  const before = `# Plan\n\nquarterly roadmap\n\n${lines(8, 'filler')}\n\nbudget: 10\n\n${lines(8, 'more')}\n\nowner: ana\n`;
  const after = before.replace('quarterly', 'yearly').replace('budget: 10', 'budget: 99').replace('owner: ana', 'owner: bob');
  fs.mkdirSync(path.join(noted.vault, 'drafts'));
  fs.writeFileSync(path.join(noted.vault, 'drafts', 'Plan.md'), before);
  const { win, vault } = await noted.relaunch();
  const change = addPending(vault, { client: 'claude-code', tool: 'update_note', kind: 'update', note: 'drafts/Plan.md', baseEtag: etagOf(before), before, after });

  await win.getByTestId('pending-badge').click({ timeout: 20_000 });
  const item = win.getByTestId('pending-list').locator(`[data-pending="${change.id}"]`);
  await expect(item.locator('[data-change]')).toHaveCount(3);
  await expect(item.getByTestId('review-count')).toHaveText('3 of 3 changes kept');

  // Drop the budget change, keep the other two
  await item.locator('[data-change="1"]').getByRole('button', { name: 'Drop' }).click();
  await item.getByRole('button', { name: 'Approve 2 of 3' }).click();
  const expected = before.replace('quarterly', 'yearly').replace('owner: ana', 'owner: bob');
  await expect.poll(() => fs.readFileSync(path.join(vault, 'drafts', 'Plan.md'), 'utf8'), { timeout: 15_000 }).toBe(expected);
  expect(fs.readFileSync(path.join(vault, 'drafts', 'Plan.md'), 'utf8')).toContain('budget: 10'); // the dropped change is not there
  expect(fs.existsSync(path.join(vault, '.noted_history', 'drafts', 'Plan.md'))).toBe(true);
  await expect(item).toHaveCount(0);

  // The journal says what was written, not what the agent proposed
  const journal = fs.readdirSync(path.join(vault, '.noted', 'journal')).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
  expect(journal.length).toBeGreaterThan(0);
});
