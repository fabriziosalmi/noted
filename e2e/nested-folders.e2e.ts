import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// Notes in folders at any depth (#65), on the real app: they are listed, open and save where they are,
// and renaming, moving and deleting a folder carries everything under it, with the links.
const MOD = 'ControlOrMeta';

// A Markdown vault: where an Obsidian-style tree is at home, and a typed [[link]] is a real link in the editor.
const NOTES: Record<string, string> = {
  'Home.md': '# Home\n\nsee [[Work/Q4/Goals]] and [[Deep note]] and [[Plan]]\n',
  'Work/Plan.md': '# Plan\n\nthe plan\n',
  'Work/Q4/Goals.md': '# Goals\n\nreach [[Deep note]]\n',
  'Work/Q4/Deep/Deep note.md': '# Deep note\n\nfar down\n',
};

async function vault(noted: Parameters<Parameters<typeof test>[2]>[0]['noted'], extra: Record<string, string> = {}) {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  for (const [name, text] of Object.entries({ ...NOTES, ...extra })) {
    fs.mkdirSync(path.dirname(path.join(noted.vault, name)), { recursive: true });
    fs.writeFileSync(path.join(noted.vault, name), text);
  }
  return noted.relaunch();
}

const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('nested folders', () => {
  test('notes three levels deep are listed, open, and save where they are', async ({ noted }) => {
    const { win, vault: root } = await vault(noted);
    // A tree: each folder under its parent, by its own name.
    await expect(win.getByText('Deep', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(win.getByText('Q4', { exact: true })).toBeVisible();
    await expect(win.getByText('Work', { exact: true })).toBeVisible();
    await win.getByRole('button', { name: /^Deep note/ }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Deep note');

    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' edited down here');
    await expect.poll(() => read(root, 'Work/Q4/Deep/Deep note.md'), { timeout: 15_000 }).toContain('edited down here');
    expect(fs.existsSync(path.join(root, 'Deep note.md'))).toBe(false); // not moved to the top, not duplicated
    // linked from two notes, by bare name, though they are folders away
    await expect(win.getByRole('button', { name: '[[Home]]' }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('following a link to a note in a deep folder opens it, and creates nothing', async ({ noted }) => {
    const { win, vault: root } = await vault(noted);
    await win.getByRole('button', { name: /^Home/ }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Home');
    await editor.locator('[data-wikilink="Deep note"]').first().click();
    await expect(editor.locator('h1')).toHaveText('Deep note');
    expect(fs.existsSync(path.join(root, 'Deep note.md'))).toBe(false);
  });

  test('renaming a folder moves everything under it, and the links to it follow', async ({ noted }) => {
    const { win, vault: root } = await vault(noted);
    await expect(win.getByText('Q4', { exact: true })).toBeVisible({ timeout: 20_000 });
    await win.getByText('Q4', { exact: true }).dblclick();
    const input = win.getByRole('textbox').filter({ hasNot: win.locator('[placeholder]') }).last();
    await input.fill('Q5');
    await input.press('Enter');
    await expect.poll(() => fs.existsSync(path.join(root, 'Work/Q5/Goals.md')), { timeout: 15_000 }).toBe(true);
    expect(fs.existsSync(path.join(root, 'Work/Q5/Deep/Deep note.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Work/Q4'))).toBe(false);
    // the link written with the old folder path follows; the bare ones still find their notes
    await expect.poll(() => read(root, 'Home.md'), { timeout: 15_000 }).toContain('[[Work/Q5/Goals]]');
    expect(read(root, 'Home.md')).toContain('[[Deep note]]');
  });

  test('deleting a folder keeps what is in it: it moves up one level, sub-folders whole', async ({ noted }) => {
    const { win, vault: root } = await vault(noted);
    await expect(win.getByText('Q4', { exact: true })).toBeVisible({ timeout: 20_000 });
    const header = win.getByText('Q4', { exact: true }).locator('xpath=ancestor::*[@draggable="true"][1]');
    await header.hover();
    await header.getByRole('button', { name: 'Delete folder' }).click();
    await win.getByRole('dialog').getByRole('button', { name: 'Delete folder' }).click();

    await expect.poll(() => fs.existsSync(path.join(root, 'Work/Q4')), { timeout: 15_000 }).toBe(false);
    expect(read(root, 'Work/Goals.md')).toContain('Goals'); // up into "Work", not to the root
    expect(read(root, 'Work/Deep/Deep note.md')).toContain('far down'); // the sub-folder went up whole
    expect(fs.existsSync(path.join(root, 'Goals.md'))).toBe(false);
    await expect.poll(() => read(root, 'Home.md'), { timeout: 15_000 }).toContain('[[Work/Goals]]');
  });

  test('collapsing a folder hides everything under it, and a new folder can be made inside one', async ({ noted }) => {
    const { win, vault: root } = await vault(noted);
    await expect(win.getByText('Deep', { exact: true })).toBeVisible({ timeout: 20_000 });
    await win.getByText('Work', { exact: true }).click(); // collapse
    await expect(win.getByText('Q4', { exact: true })).toHaveCount(0);
    await expect(win.getByText('Deep', { exact: true })).toHaveCount(0);
    await win.getByText('Work', { exact: true }).click(); // expand
    await expect(win.getByText('Deep', { exact: true })).toBeVisible();

    const header = win.getByText('Q4', { exact: true }).locator('xpath=ancestor::*[@draggable="true"][1]');
    await header.hover();
    await header.getByRole('button', { name: 'New folder inside' }).click();
    const input = win.getByPlaceholder('New folder in Work/Q4');
    await input.fill('Retro');
    await input.press('Enter');
    await expect.poll(() => fs.existsSync(path.join(root, 'Work/Q4/Retro')), { timeout: 15_000 }).toBe(true);
    await expect(win.getByText('Retro', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('dragging a folder onto another moves it there, with its notes, and onto the list brings it to the top', async ({ noted }) => {
    // one launch only: a second one on the same profile is where Windows keeps a file open for a while at teardown
    const { win: w, vault: root } = await vault(noted, { 'Life/Garden.md': '# Garden\n\ngreen\n' });
    await expect(w.getByText('Life', { exact: true })).toBeVisible({ timeout: 20_000 });
    const box = (label: string) => w.getByText(label, { exact: true }).locator('xpath=ancestor::*[@draggable="true"][1]');

    // the middle of a folder header means "into it"
    await box('Q4').dragTo(box('Life'));
    await expect.poll(() => fs.existsSync(path.join(root, 'Life/Q4/Goals.md')), { timeout: 15_000 }).toBe(true);
    expect(fs.existsSync(path.join(root, 'Life/Q4/Deep/Deep note.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Work/Q4'))).toBe(false);
    await expect.poll(() => fs.readFileSync(path.join(root, 'Home.md'), 'utf8'), { timeout: 15_000 }).toContain('[[Life/Q4/Goals]]');

    // and onto the empty part of the list, it comes back to the top level
    const list = w.getByText('Life', { exact: true }).locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
    await box('Q4').dragTo(list, { targetPosition: { x: 60, y: 300 } });
    await expect.poll(() => fs.existsSync(path.join(root, 'Q4/Goals.md')), { timeout: 15_000 }).toBe(true);
    expect(fs.existsSync(path.join(root, 'Life/Q4'))).toBe(false);
  });
});

