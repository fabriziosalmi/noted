import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// [[Note#Heading]] and [[Note#^block]] (#67): completed after the `#`, and followed to the place they name.
const filler = (n: number): string => Array.from({ length: n }, (_, i) => `Paragraph ${i} with enough words to take up a line of the page.`).join('\n\n');
const PLAN = `# Plan\n\n${filler(30)}\n\n## Budget\n\n${filler(30)}\n\n## Risks and *limits*\n\n${filler(30)}\n\nThe claim to cite later. ^claim-1\n\n${filler(30)}\n\n## The end\n\nlast\n`;

test('heading links: complete the headings after #, follow a heading link and a block link', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Plan.md'), PLAN);
  fs.writeFileSync(path.join(noted.vault, 'Source.md'), '# Source\n\nstart\n');
  const { win, vault } = await noted.relaunch();
  const editor = win.locator('[contenteditable="true"]').first();

  await win.getByRole('button', { name: /^Source/ }).first().click();
  await expect(editor.locator('h1')).toHaveText('Source');
  await editor.getByText('start').click();
  await win.keyboard.press('End');

  // After `[[Plan#` the headings of Plan are offered, filtered as you type
  await win.keyboard.type(' see [[Plan#');
  const menu = win.getByRole('button', { name: /^H[1-6]$|Budget|Risks/ });
  await expect(menu.filter({ hasText: 'Budget' })).toBeVisible({ timeout: 15_000 });
  await win.keyboard.type('risk');
  await expect(menu.filter({ hasText: 'Budget' })).toHaveCount(0);
  await win.keyboard.press('Enter');
  await expect(editor.locator('[data-wikilink="Plan"]')).toHaveText('[[Plan#Risks and limits]]');

  // A block link, typed whole (it becomes a link the next time the note is read)
  await win.keyboard.type('and [[Plan#^claim-1]] '); // the completed link is followed by a space already
  await expect.poll(() => fs.readFileSync(path.join(vault, 'Source.md'), 'utf8'), { timeout: 15_000 })
    .toContain('[[Plan#Risks and limits]] and [[Plan#^claim-1]]');

  // Following the heading link opens Plan at that heading, far down a long page
  await editor.locator('[data-wikilink="Plan"]').first().click();
  await expect(editor.locator('h1')).toHaveText('Plan');
  const heading = editor.getByRole('heading', { name: 'Risks and limits' });
  await expect(heading).toBeInViewport({ timeout: 10_000 });
  await expect(editor.getByRole('heading', { name: 'Plan', exact: true })).not.toBeInViewport();

  // ...and the block link goes to the block
  await win.getByRole('button', { name: /^Source/ }).first().click();
  await expect(editor.locator('h1')).toHaveText('Source');
  await expect(editor.locator('[data-wikilink="Plan"]')).toHaveCount(2);
  await editor.locator('[data-wikilink="Plan"]').nth(1).click();
  await expect(editor.getByText('The claim to cite later.')).toBeInViewport({ timeout: 10_000 });
});
