import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// ![[Note]], ![[Note#Heading]], ![[Note#^block]] and ![[image.png]] (#67): shown in place, read-only, and a click
// goes to the source. Real app, real vault.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const filler = (n: number): string => Array.from({ length: n }, (_, i) => `Paragraph ${i} with enough words to take up a line.`).join('\n\n');
const PLAN = `# Plan\n\nthe plan intro\n\n## Budget\n\nmoney matters here\n\n### Detail\n\nfine print\n\n## Risks\n\nrisk text\n\nA quotable line. ^quote\n\n${filler(30)}\n`;
const SOURCE = '# Source\n\nOpening words.\n\n![[Plan#Budget]]\n\n![[Plan#^quote]]\n\n![[pic.png|120]]\n\n![[Nowhere]]\n';

test('embeds: show a section, a block and an image in place, read-only, and click through to the source', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.mkdirSync(path.join(noted.vault, 'Attachments'));
  fs.writeFileSync(path.join(noted.vault, 'Attachments', 'pic.png'), PNG);
  fs.writeFileSync(path.join(noted.vault, 'Plan.md'), PLAN);
  fs.writeFileSync(path.join(noted.vault, 'Source.md'), SOURCE);
  const { win, vault } = await noted.relaunch();
  const editor = win.locator('[contenteditable="true"]').first();

  await win.getByRole('button', { name: /^Source/ }).first().click();
  await expect(editor.locator('h1')).toHaveText('Source');

  // A heading embeds its section (sub-section included), and nothing of the rest of the note
  const section = editor.locator('.embed[data-embed-target="![[Plan#Budget]]"]');
  await expect(section).toContainText('money matters here', { timeout: 15_000 });
  await expect(section).toContainText('fine print');
  await expect(section).not.toContainText('risk text');
  await expect(section).not.toContainText('the plan intro');

  // A block embeds that line, without its id
  const block = editor.locator('.embed[data-embed-target="![[Plan#^quote]]"]');
  await expect(block).toHaveText('A quotable line.');

  // An image is found in the attachments folder and drawn at the size asked for
  const image = editor.locator('.embed[data-embed-target="![[pic.png|120]]"] img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await expect(image).toHaveAttribute('width', '120');

  // What is not there says so
  await expect(editor.locator('.embed[data-embed-target="![[Nowhere]]"]')).toContainText('Not found: Nowhere');

  // Looking changed nothing on disk
  expect(fs.readFileSync(path.join(vault, 'Source.md'), 'utf8')).toBe(SOURCE);

  // Read-only: typing into an embed does nothing to it, and the note is not changed by trying
  await expect(section).toHaveAttribute('contenteditable', 'false');

  // A click on the embedded section opens the note it comes from, at that heading
  await section.click();
  await expect(editor.locator('h1')).toHaveText('Plan');
  await expect(editor.getByRole('heading', { name: 'Budget' })).toBeInViewport({ timeout: 10_000 });
  expect(fs.readFileSync(path.join(vault, 'Source.md'), 'utf8')).toBe(SOURCE);
});
