import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, SEED_NOTES } from './fixtures';

// Prompts kept as notes (#77), through the real app and a fake model: one on the selection from the AI bar (through the review), one
// from the slash menu, and a prompt made from the menu.
test('prompts: notes in prompts/ are in the AI bar and the slash menu, filled in with the selection, the note and the date', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Note.md'), '# Note\n\nhey there friend\n');
  fs.mkdirSync(path.join(noted.vault, 'prompts'));
  fs.writeFileSync(path.join(noted.vault, 'prompts', 'Make formal.md'), '---\nname: Make formal\nscope: selection\ndescription: In a formal tone\n---\nRewrite formally ({{date}}):\n\n{{selection}}\n');
  fs.writeFileSync(path.join(noted.vault, 'prompts', 'Haiku.md'), '---\nname: Haiku\nscope: note\n---\nA haiku about this note:\n\n{{note}}\n');

  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    if (!req.url?.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const user = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages.find(m => m.role === 'user')?.content ?? '';
      asked.push(user);
      const answer = user.startsWith('Rewrite formally') ? 'Good day, dear friend' : user.startsWith('A haiku') ? 'Autumn leaves fall softly' : 'unexpected';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
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
    await win.getByText('Note', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Note');

    // From the AI bar: a prompt for a selection waits for one; with it, the rewrite is read first and then applied
    await win.getByLabel('Prompts').click();
    const menu = win.getByRole('menu', { name: 'Prompts' });
    await expect(menu.getByRole('menuitem', { name: /Make formal/ })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: /Haiku/ })).toBeEnabled();
    await win.keyboard.press('Escape');

    await editor.getByText('hey there friend').click({ clickCount: 3 });
    await win.getByLabel('Prompts').click();
    await menu.getByRole('menuitem', { name: /Make formal/ }).click();
    const dialog = win.getByRole('dialog');
    await expect(dialog).toContainText('Make formal: review the edit', { timeout: 20_000 });
    expect(asked[0]).toMatch(/^Rewrite formally \(\d{4}-\d{2}-\d{2}\):\n\nhey there friend$/);
    await expect(editor).toContainText('hey there friend'); // nothing replaced while it is read
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(editor).toContainText('Good day, dear friend');
    await expect(editor).not.toContainText('hey there friend');

    // From the slash menu: a prompt for the note, answered at the caret
    await editor.getByText('Good day, dear friend').click();
    await win.keyboard.press('End');
    await win.keyboard.type(' /hai');
    await expect(win.getByText('Your prompts')).toBeVisible();
    await win.keyboard.press('Enter');
    await expect(editor).toContainText('Autumn leaves fall softly', { timeout: 20_000 });
    expect(asked[1]).toContain('A haiku about this note:');
    expect(asked[1]).toContain('Good day, dear friend');
    await expect(editor).not.toContainText('/hai');

    // A new prompt from the menu: a note in prompts/ to start from, opened for writing
    await win.getByLabel('Prompts').click();
    await win.getByRole('menu', { name: 'Prompts' }).getByRole('menuitem', { name: 'New prompt' }).last().click();
    await expect.poll(() => fs.existsSync(path.join(vault, 'prompts', 'New prompt.md')), { timeout: 15_000 }).toBe(true);
    expect(fs.readFileSync(path.join(vault, 'prompts', 'New prompt.md'), 'utf8')).toMatch(/^---\nname: New prompt\nscope: selection\n[\s\S]*\{\{selection\}\}/);
    await expect(editor).toContainText('Rewrite the following text more clearly');
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
