import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// Renaming a note must not leave [[links]] to it dangling: every link form is
// rewritten on disk, each changed note keeps a history snapshot of what it was,
// and retyping a title rewrites the links once, not at every pause.

const NOTES: [string, string][] = [
  ['Target.md', '<h1>Target</h1><p>the note that gets renamed</p>'],
  ['Plain.md', '<h1>Plain</h1><p>[[Target]]</p>'],
  ['Forms.md', '<h1>Forms</h1><p>[[Target|an alias]] [[Target#Setup]] [[target]]</p>'],
  ['Editor.md', '<h1>Editor</h1><p><span data-wikilink="Target" class="wikilink" role="link">[[Target]]</span></p>'],
  ['Bystander.md', '<h1>Bystander</h1><p>[[Something else]] and no link to it</p>'],
];

const read = (vault: string, n: string) => fs.readFileSync(path.join(vault, n), 'utf8');

test.describe('renaming rewrites inbound links', () => {
  test('a manual rename in the sidebar rewrites every link form, with a history snapshot per note', async ({ noted }) => {
    for (const [n, html] of NOTES) fs.writeFileSync(path.join(noted.vault, n), html);
    const { win, vault } = await noted.relaunch();

    // Rename Target -> Renamed target, from the sidebar (double-click the row).
    const row = win.getByRole('button', { name: /^Target/ }).first();
    await row.click();
    await expect(win.locator('[contenteditable="true"]').first()).toContainText('the note that gets renamed');
    await row.dblclick();
    const input = win.getByRole('textbox', { name: 'Rename' });
    await input.fill('Renamed target');
    await input.press('Enter');

    await expect.poll(() => fs.existsSync(path.join(vault, 'Renamed target.md')), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => read(vault, 'Plain.md'), { timeout: 15_000 }).toContain('[[Renamed target]]');

    expect(read(vault, 'Plain.md')).toBe('<h1>Plain</h1><p>[[Renamed target]]</p>');
    expect(read(vault, 'Forms.md')).toBe('<h1>Forms</h1><p>[[Renamed target|an alias]] [[Renamed target#Setup]] [[Renamed target]]</p>');
    expect(read(vault, 'Editor.md')).toBe('<h1>Editor</h1><p><span data-wikilink="Renamed target" class="wikilink" role="link">[[Renamed target]]</span></p>');
    expect(read(vault, 'Bystander.md')).toBe(NOTES[4][1]); // untouched, byte for byte

    // Each rewritten note kept what it looked like before, so it can be undone.
    for (const n of ['Plain.md', 'Forms.md', 'Editor.md']) {
      const hist = path.join(vault, '.noted_history', n);
      const snaps = fs.readdirSync(hist).map(f => fs.readFileSync(path.join(hist, f), 'utf8'));
      expect(snaps.some(c => /\[\[[Tt]arget[\]|#]/.test(c) && !c.includes('Renamed target'))).toBe(true);
    }
    expect(fs.existsSync(path.join(vault, '.noted_history', 'Bystander.md'))).toBe(false);
  });

  test('retyping a title renames the file and rewrites the links once, when the user moves on', async ({ noted }) => {
    for (const [n, html] of NOTES) fs.writeFileSync(path.join(noted.vault, n), html);
    const { win, vault } = await noted.relaunch();

    await win.getByText('Target', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('the note that gets renamed');
    // Replace the title (the first line) with a new one.
    await editor.locator('h1').click();
    await win.keyboard.press('End');
    await win.keyboard.press('Shift+Home');
    await win.keyboard.type('Fresh title');

    // The file follows the title...
    await expect.poll(() => fs.existsSync(path.join(vault, 'Fresh title.md')), { timeout: 15_000 }).toBe(true);
    // ...and the links are NOT rewritten yet (held back while the user may still be typing).
    expect(read(vault, 'Plain.md')).toContain('[[Target]]');

    // Moving to another note settles it.
    await win.getByText('Bystander', { exact: true }).first().click();
    await expect.poll(() => read(vault, 'Plain.md'), { timeout: 15_000 }).toContain('[[Fresh title]]');
    expect(read(vault, 'Forms.md')).toContain('[[Fresh title|an alias]]');
    expect(read(vault, 'Editor.md')).toContain('data-wikilink="Fresh title"');
  });
});
