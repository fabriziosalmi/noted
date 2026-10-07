import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, SEED_NOTES } from './fixtures';

// A note from a source (#79), through the real app and a fake model: pasted text becomes a note in sources/ with where it came from and
// the notes it is near (read first, each link kept or dropped); and the address of this very machine is refused by the real guard.
const ARTICLE = 'Quarterly planning is how a team decides what to build next. The best teams write the plan down, review the risks, and agree who owns each goal before the quarter starts. '.repeat(3);

test('ingest: pasted text becomes a source note with its provenance and related links; a loopback address is refused', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Planning.md'), '# Planning\n\n## Goals\n\nQuarterly planning means deciding what to build next and who owns each goal.\n');
  fs.writeFileSync(path.join(noted.vault, 'Gardening.md'), '# Gardening\n\nTomatoes need sun and regular water.\n');

  // The model; and a web server on this machine that must never be contacted
  const forbidden: string[] = [];
  const target = http.createServer((req, res) => { forbidden.push(req.url ?? ''); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>secret</body></html>'); });
  await new Promise<void>(r => target.listen(0, '127.0.0.1', r));
  const targetPort = (target.address() as AddressInfo).port;
  const model = http.createServer((req, res) => {
    if (!req.url?.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const user = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages.find(m => m.role === 'user')?.content ?? '';
      const answer = /Quarterly planning/.test(user) ? JSON.stringify({ title: 'How teams plan a quarter', summary: 'Teams write the plan down, review risks and name an owner for each goal.', key_points: ['Write the plan', 'Review the risks', 'Name an owner'] }) : 'unexpected';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
  });
  await new Promise<void>(r => model.listen(0, '127.0.0.1', r));
  const modelPort = (model.address() as AddressInfo).port;
  try {
    const { win, vault } = await noted.relaunch();
    await win.addInitScript(p => {
      const raw = localStorage.getItem('noted-storage');
      const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
      j.state = j.state || {};
      j.state.settings = { ...(j.state.settings || {}), language: 'en', llmProvider: 'lmstudio', lmStudioUrl: `http://127.0.0.1:${p}/v1`, llmModel: 'fake', piiMasking: false, embeddingsEnabled: false };
      localStorage.setItem('noted-storage', JSON.stringify(j));
    }, modelPort);
    await win.reload();
    await expect(win.getByText('Planning', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // An address of this very machine is refused, and the server there is never asked
    await win.getByLabel('Note from a web page or text…').first().click();
    const dialog = win.getByRole('dialog');
    await dialog.getByLabel('Web address').fill(`http://127.0.0.1:${targetPort}/secret`);
    await dialog.getByRole('button', { name: 'Read and summarise' }).click();
    await expect(dialog.getByTestId('ingest-error')).toContainText('not a public address', { timeout: 15_000 });
    expect(forbidden).toEqual([]);

    // Pasted text: summarised, with the notes it is near to read first
    await dialog.getByLabel('Web address').fill('');
    await dialog.getByLabel('Or paste text').fill(ARTICLE);
    await dialog.getByRole('button', { name: 'Read and summarise' }).click();
    await expect(dialog.getByTestId('ingest-preview')).toContainText('review risks and name an owner', { timeout: 30_000 });
    await expect(dialog.getByLabel('Note title')).toHaveValue('How teams plan a quarter');
    await expect(dialog.locator('[data-change]')).toHaveCount(1);
    await expect(dialog.locator('[data-change]')).toContainText('[[Planning]]'); // the planning note, not the one about tomatoes
    expect(fs.existsSync(path.join(vault, 'sources'))).toBe(false); // nothing is written while it is read

    await dialog.getByRole('button', { name: 'Create note' }).click();
    const file = path.join(vault, 'sources', 'How teams plan a quarter.md');
    await expect.poll(() => fs.existsSync(file), { timeout: 15_000 }).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/^---\ntype: source\nsource: pasted\nsource_hash: sha256:[0-9a-f]{64}\nretrieved_at: \d{4}-\d{2}-\d{2}T[\d:.]+Z\nmodel: lmstudio\/fake\n---\n/);
    expect(text).toContain('# How teams plan a quarter');
    expect(text).toContain('Teams write the plan down');
    expect(text).toContain('- Name an owner');
    expect(text).toContain('[[Planning]]');
    expect(text).not.toContain('Gardening');
    // It opened, and it is a note like any other: Planning now has a backlink from it
    await expect(win.locator('[contenteditable="true"]').first().locator('h1')).toHaveText('How teams plan a quarter', { timeout: 15_000 });
  } finally {
    model.closeAllConnections(); target.closeAllConnections();
    await new Promise(r => model.close(r));
    await new Promise(r => target.close(r));
  }
});
