import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

const MOD = 'ControlOrMeta';

// A vault marked as Markdown (ADR 0001): its notes are Markdown files. The app must read them, edit them,
// index them and write them back in Markdown, without ever turning them into HTML or into outside changes.
const MARKER = '.noted-vault.json';
const NOTES: [string, string][] = [
  ['Hub.md', '---\ntitle: Hub\nstatus: draft\n---\n\n# Hub\n\nTalks to [[Spoke]] and [[Satellite|the sat]] #alpha\n\n- [ ] first task\n- [x] done task\n\n> [!note] Heads up\n> A callout body.\n'],
  ['Spoke.md', '# Spoke\n\nA plain note with **bold** and `code`. #beta\n\n| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n'],
  ['Satellite.md', '# Satellite\n\nSee [[Spoke#Setup]].\n'],
];

/** Turn the seeded HTML vault into a Markdown one and restart the app on it. */
async function markdownVault(noted: Parameters<Parameters<typeof test>[2]>[0]['noted']) {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  for (const [name, text] of NOTES) fs.writeFileSync(path.join(noted.vault, name), text);
  fs.writeFileSync(path.join(noted.vault, MARKER), JSON.stringify({ format: 'markdown' }));
  return noted.relaunch();
}

test.describe('a Markdown vault', () => {
  test('shows its notes as rich text, with clean previews, tags and backlinks', async ({ noted }) => {
    const { win } = await markdownVault(noted);
    await expect(win.getByText('Hub', { exact: true }).first()).toBeVisible();
    // The sidebar preview is prose, not Markdown syntax.
    await expect(win.getByText('Talks to Spoke and the sat #alpha', { exact: false }).first()).toBeVisible();

    await win.getByText('Hub', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Hub');
    await expect(editor.locator('span.wikilink').first()).toHaveText('[[Spoke]]');
    await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(2);
    await expect(editor.locator('div[data-callout="note"]')).toContainText('A callout body.');

    await win.getByText('Spoke', { exact: true }).first().click();
    await expect(editor.locator('table')).toBeVisible();
    await expect(editor.locator('strong')).toHaveText('bold');
    await expect(win.getByRole('button', { name: '[[Hub]]' })).toBeVisible(); // backlink, from the index
  });

  test('editing writes Markdown back: same note, frontmatter untouched, never HTML', async ({ noted }) => {
    const { win, vault } = await markdownVault(noted);
    await win.getByText('Hub', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' typed-in-e2e');
    const read = () => fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8');
    await expect.poll(read, { timeout: 15_000 }).toContain('typed-in-e2e');

    const saved = read();
    expect(saved.startsWith('---\ntitle: Hub\nstatus: draft\n---\n\n# Hub\n')).toBe(true);
    expect(saved).toContain('Talks to [[Spoke]] and [[Satellite|the sat]] #alpha');
    expect(saved).toContain('- [ ] first task\n- [x] done task');
    expect(saved).toContain('> [!note] Heads up\n> A callout body.');
    expect(saved).not.toMatch(/<(p|h1|ul|li|span|div)\b/);
    // saving did not look like an outside change, so no "other version" copy appeared
    await win.waitForTimeout(1500);
    expect(fs.readdirSync(vault).filter(f => f.includes('(other version)'))).toEqual([]);
  });

  test('a note written from outside, in Markdown, reloads in the open editor', async ({ noted }) => {
    const { win, vault } = await markdownVault(noted);
    await win.getByText('Spoke', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('strong')).toHaveText('bold');
    fs.writeFileSync(path.join(vault, 'Spoke.md'), '# Spoke\n\nRewritten *elsewhere* by a sync.\n');
    await expect(editor.locator('em')).toHaveText('elsewhere', { timeout: 15_000 });
  });

  test('a new note and a quick edit are Markdown files too', async ({ noted }) => {
    const { win, vault } = await markdownVault(noted);
    await win.keyboard.press(`${MOD}+KeyN`);
    await expect(win.locator('[contenteditable="true"]').first()).toBeVisible();
    await win.keyboard.type('Epsilon markdown check');
    await expect.poll(() => fs.readdirSync(vault).some(f => f.startsWith('Epsilon markdown check')), { timeout: 15_000 }).toBe(true);
    const file = fs.readdirSync(vault).find(f => f.startsWith('Epsilon markdown check'))!;
    await expect.poll(() => fs.readFileSync(path.join(vault, file), 'utf8'), { timeout: 15_000 }).toMatch(/^# Epsilon markdown check\n/);
    expect(fs.readFileSync(path.join(vault, file), 'utf8')).not.toContain('<');
  });

  test('search finds Markdown notes by their words, and renaming a note rewrites the links to it', async ({ noted }) => {
    const { win, vault } = await markdownVault(noted);
    await win.keyboard.press(`${MOD}+Shift+KeyF`);
    await win.keyboard.type('callout');
    await expect(win.getByText('Hub').last()).toBeVisible();
    await win.keyboard.press('Escape');

    await win.getByText('Spoke', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await editor.locator('h1').click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.press('Home');
    await win.keyboard.type('Hub spoke ');
    await expect.poll(() => fs.existsSync(path.join(vault, 'Hub spoke Spoke.md')) || fs.readdirSync(vault).some(f => f.startsWith('Hub spoke')), { timeout: 20_000 }).toBe(true);
    const renamed = fs.readdirSync(vault).find(f => f.startsWith('Hub spoke'))!;
    const target = renamed.replace(/\.md$/, '');
    await expect.poll(() => fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8'), { timeout: 20_000 }).toContain(`[[${target}]]`);
    expect(fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8')).toContain('[[Satellite|the sat]]');
  });
});
