import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// The Settings screen for converting a vault between HTML and Markdown (ADR 0001), on the real app: the
// report comes first and changes nothing, the user confirms, the notes are rewritten, and the way back works.
const marker = (vault: string): string | null => {
  try { return JSON.parse(fs.readFileSync(path.join(vault, '.noted-vault.json'), 'utf8')).format; } catch { return null; }
};

test.describe('Settings: note format', () => {
  test('shows the plan, converts only after a yes, and goes back again', async ({ noted }) => {
    const { win, vault } = noted;
    const hub = '<h1>Hub</h1><p>Talks to [[Spoke]] with <strong>bold</strong> and E = mc<sup>2</sup></p>';
    fs.writeFileSync(path.join(vault, 'Hub.md'), hub);
    const seeded = noted.readVault();

    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('tab', { name: 'Editor' }).click();
    await expect(win.getByTestId('note-format-current')).toContainText('HTML');
    await win.getByRole('button', { name: 'Convert to Markdown…' }).click();

    // The report: counts, the note that keeps something raw, and nothing written yet.
    const dialog = win.getByRole('dialog').last();
    await expect(dialog.getByTestId('note-format-summary')).toContainText('to convert');
    await expect(dialog.getByTestId('note-format-notes')).toContainText('Hub.md');
    expect(noted.readVault()).toEqual(seeded);
    expect(marker(vault)).toBeNull();

    // Cancelling changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(win.getByTestId('note-format-summary')).toHaveCount(0);
    expect(marker(vault)).toBeNull();

    await win.getByRole('button', { name: 'Convert to Markdown…' }).click();
    await win.getByRole('dialog').last().getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(win.getByTestId('note-format-done')).toBeVisible({ timeout: 30_000 });

    expect(marker(vault)).toBe('markdown');
    expect(fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8')).toBe('# Hub\n\nTalks to [[Spoke]] with **bold** and E = mc<sup>2</sup>\n');
    expect(fs.readdirSync(path.join(vault, '.noted', 'backups')).some(f => f.endsWith('.zip'))).toBe(true);

    await win.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).click();
    await expect(win.getByTestId('note-format-current')).toContainText('Markdown');

    // And back: the same notes, as HTML again.
    await win.getByRole('button', { name: 'Convert back to HTML…' }).click();
    await win.getByRole('dialog').last().getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(win.getByTestId('note-format-done')).toBeVisible({ timeout: 30_000 });
    expect(marker(vault)).toBe('html');
    expect(fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8')).toMatch(/<h1>Hub<\/h1>/);
  });

  test('what was typed a moment ago is saved, and converted, not lost', async ({ noted }) => {
    const { win, vault } = noted;
    await win.getByText('Alpha plan', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Alpha plan');
    await editor.click();
    await win.keyboard.press('ControlOrMeta+End');
    await win.keyboard.type(' just-typed');

    // straight to Settings, inside the autosave delay
    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('tab', { name: 'Editor' }).click();
    await win.getByRole('button', { name: 'Convert to Markdown…' }).click();
    await win.getByRole('dialog').last().getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(win.getByTestId('note-format-done')).toBeVisible({ timeout: 30_000 });

    const note = fs.readFileSync(path.join(vault, 'Alpha plan.md'), 'utf8');
    expect(note).toContain('just-typed');
    expect(note).not.toMatch(/<(p|h1)\b/);
  });
});
