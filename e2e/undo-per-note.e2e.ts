import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// One editor shows every note, so its undo history must start over with each one. Otherwise undo in the note just
// opened walks back into the previous note: it puts that note's text here, autosave writes it to this file, and the
// title sync renames the file after the other note. The note that was open is gone.

const read = (vault: string, n: string) => fs.readFileSync(path.join(vault, n), 'utf8');
const FIRST = '<h1>First note</h1><p>Alpha body text.</p>';
const SECOND = '<h1>Second note</h1><p>Beta body text.</p>';

test.describe('undo stays inside the open note', () => {
  test('undo after switching notes leaves the note just opened as it was', async ({ noted }) => {
    fs.writeFileSync(path.join(noted.vault, 'First note.md'), FIRST);
    fs.writeFileSync(path.join(noted.vault, 'Second note.md'), SECOND);
    const { win, vault } = await noted.relaunch();
    const editor = win.locator('[contenteditable="true"]').first();

    await win.getByText('First note', { exact: true }).first().click();
    await expect(editor).toContainText('Alpha body text.');
    await editor.locator('p').last().click();
    await win.keyboard.press('End');
    await win.keyboard.type(' typed in first');
    await expect.poll(() => read(vault, 'First note.md'), { timeout: 15_000 }).toContain('typed in first');

    await win.getByText('Second note', { exact: true }).first().click();
    await expect(editor).toContainText('Beta body text.');
    await editor.locator('p').last().click();
    for (let i = 0; i < 3; i++) await win.keyboard.press('ControlOrMeta+KeyZ');

    await expect(editor).toContainText('Beta body text.');
    await expect(editor).not.toContainText('Alpha body text.');
    // Give a wrongly armed autosave and title sync time to land before reading the disk.
    await win.waitForTimeout(3_000);
    expect(fs.existsSync(path.join(vault, 'Second note.md'))).toBe(true);
    expect(read(vault, 'Second note.md')).toBe(SECOND);
    expect(read(vault, 'First note.md')).toContain('typed in first');

    // Undo still works inside the note.
    await win.keyboard.press('End');
    await win.keyboard.type(' typed in second');
    await expect(editor).toContainText('typed in second');
    await win.keyboard.press('ControlOrMeta+KeyZ');
    await expect(editor).not.toContainText('typed in second');
    await expect(editor).toContainText('Beta body text.');
  });

  test('undo after a note is reloaded from disk does not bring the replaced text back', async ({ noted }) => {
    fs.writeFileSync(path.join(noted.vault, 'First note.md'), FIRST);
    const { win, vault } = await noted.relaunch();
    const editor = win.locator('[contenteditable="true"]').first();

    await win.getByText('First note', { exact: true }).first().click();
    await expect(editor).toContainText('Alpha body text.');

    // Another writer (a git pull, an MCP client) changes the open note on disk.
    const external = '<h1>First note</h1><p>Written elsewhere.</p>';
    fs.writeFileSync(path.join(vault, 'First note.md'), external);
    await expect(editor).toContainText('Written elsewhere.', { timeout: 15_000 });

    await editor.locator('p').last().click();
    for (let i = 0; i < 3; i++) await win.keyboard.press('ControlOrMeta+KeyZ');

    await expect(editor).toContainText('Written elsewhere.');
    await win.waitForTimeout(3_000);
    expect(read(vault, 'First note.md')).toBe(external);
  });
});
