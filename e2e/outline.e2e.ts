import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// The outline panel (#70): a long note's headings as a list to jump around by, the current one marked.
const filler = (n: number): string => Array.from({ length: n }, (_, i) => `Paragraph ${i} with enough words to take up a line of the page.`).join('\n\n');
const LONG = `# Long title\n\n${filler(40)}\n\n## Middle part\n\n${filler(40)}\n\n### Deep detail\n\n${filler(40)}\n\n## The end\n\nlast words\n`;

test('outline: lists the headings, jumps to one, and marks where you are', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Long.md'), LONG);
  const { win } = await noted.relaunch();

  await win.getByRole('button', { name: /^Long/ }).first().click();
  const editor = win.locator('[contenteditable="true"]').first();
  await expect(editor.locator('h1')).toHaveText('Long title');

  await win.getByRole('button', { name: 'Toggle right panel' }).click();
  await win.getByRole('tab', { name: 'Outline' }).click();
  const outline = win.getByTestId('outline');
  await expect(outline.getByRole('button')).toHaveText(['Long title', 'Middle part', 'Deep detail', 'The end']);

  // the end of a long page is out of sight until the outline takes you there
  const end = editor.getByRole('heading', { name: 'The end' });
  await expect(end).not.toBeInViewport();
  await outline.getByRole('button', { name: 'The end' }).click();
  await expect(end).toBeInViewport({ timeout: 10_000 });
  await expect(outline.getByRole('button', { name: 'The end' })).toHaveAttribute('aria-current', 'location', { timeout: 10_000 });
  await expect(outline.getByRole('button', { name: 'Long title' })).not.toHaveAttribute('aria-current', 'location');

  // reading by scrolling back to the top moves the mark
  await editor.getByRole('heading', { name: 'Long title' }).scrollIntoViewIfNeeded();
  await expect(outline.getByRole('button', { name: 'Long title' })).toHaveAttribute('aria-current', 'location', { timeout: 10_000 });
});
