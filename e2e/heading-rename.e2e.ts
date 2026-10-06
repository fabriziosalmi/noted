import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// Renaming a heading moves the [[Note#Heading]] links that point at it (#67), following the "Update links" setting.
const PLAN = '# Plan\n\n## Risks\n\nrisk text\n\n## Budget\n\nmoney\n';
const REF = 'Refs: [[Plan#Risks]], [[Plan#risks|the risks]], ![[Plan#Risks]] and [[Plan#Budget]].\n';

async function setup(noted: Parameters<Parameters<typeof test>[2]>[0]['noted']) {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Plan.md'), PLAN);
  fs.writeFileSync(path.join(noted.vault, 'Ref.md'), REF);
  return noted.relaunch();
}

async function renameRisks(win: Awaited<ReturnType<typeof setup>>['win']) {
  await win.getByRole('button', { name: /^Plan/ }).first().click();
  const editor = win.locator('[contenteditable="true"]').first();
  await expect(editor.locator('h1')).toHaveText('Plan');
  await expect(editor).toBeFocused(); // opening a note puts the caret at its start, a moment after it shows
  const heading = editor.getByRole('heading', { name: 'Risks' });
  // A click to the right of the text puts the caret at the end of the heading (End means something else on a Mac)
  const box = (await heading.boundingBox())!;
  await heading.click({ position: { x: box.width - 4, y: box.height / 2 } });
  for (const _ of 'Risks') await win.keyboard.press('Backspace'); // eslint-disable-line @typescript-eslint/no-unused-vars
  await win.keyboard.type('Threats');
  await expect(editor.getByRole('heading', { name: 'Threats' })).toBeVisible();
  // The caret leaves the heading: the links are settled
  await editor.getByText('money').click();
}

test('heading rename: the links to it follow, by default, and nothing else changes', async ({ noted }) => {
  const { win, vault } = await setup(noted);
  await renameRisks(win);
  await expect.poll(() => fs.readFileSync(path.join(vault, 'Ref.md'), 'utf8'), { timeout: 15_000 })
    .toBe('Refs: [[Plan#Threats]], [[Plan#Threats|the risks]], ![[Plan#Threats]] and [[Plan#Budget]].\n');
  await expect.poll(() => fs.readFileSync(path.join(vault, 'Plan.md'), 'utf8'), { timeout: 15_000 }).toContain('## Threats\n\nrisk text');
});

test('heading rename: with "Ask", it asks first, and "Leave links" leaves them', async ({ noted }) => {
  const { win, vault } = await setup(noted);
  await win.addInitScript(() => {
    const raw = localStorage.getItem('noted-storage');
    const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
    j.state = j.state || {};
    j.state.settings = { ...(j.state.settings || {}), linkUpdateMode: 'ask', language: 'en' };
    localStorage.setItem('noted-storage', JSON.stringify(j));
  });
  await win.reload();
  await renameRisks(win);

  const dialog = win.getByRole('dialog');
  await expect(dialog).toContainText('"Plan#Risks"', { timeout: 15_000 });
  await expect(dialog).toContainText('3 link(s) in 1 note(s)');
  await dialog.getByRole('button', { name: 'Leave links' }).click();
  await expect(dialog).toBeHidden();
  expect(fs.readFileSync(path.join(vault, 'Ref.md'), 'utf8')).toBe(REF);
});
