import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// Images live as files under attachments/ (content-hash names) and notes keep a
// relative path: pasted images, the one-shot migration of old embedded images,
// serving through app://, and the offer to remove images only a deleted note used.

// A real 2x1 PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR4nGP8z8Dwn4EIAAA+EAH/4jNf1AAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

test.describe('image attachments', () => {
  test('a pasted image is stored as a file, the note keeps a path, and the image shows', async ({ noted }) => {
    const { win, vault } = noted;
    await win.getByText('Beta notes', { exact: true }).first().click();
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Weekly sync');
    await editor.click();

    await editor.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_B64);

    const img = editor.locator('img').first();
    await expect(img).toHaveAttribute('src', /^attachments\/[0-9a-f]{32}\.png$/, { timeout: 15_000 });
    // It actually renders: served by app:// from the vault.
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 15_000 }).toBe(2);

    const file = path.join(vault, (await img.getAttribute('src'))!);
    expect(Buffer.compare(fs.readFileSync(file), PNG)).toBe(0);

    // The note on disk carries the path, not the bytes.
    await expect.poll(() => fs.readFileSync(path.join(vault, 'Beta notes.md'), 'utf8'), { timeout: 15_000 }).toContain('attachments/');
    expect(fs.readFileSync(path.join(vault, 'Beta notes.md'), 'utf8')).not.toContain('base64');

    // Pasting the same image again stores it once. (The first image is still selected,
    // and a paste would replace it, so put the caret after it first.)
    await editor.click();
    await win.keyboard.press('ControlOrMeta+End');
    await editor.evaluate((el, b64) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'again.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_B64);
    await expect(editor.locator('img')).toHaveCount(2, { timeout: 15_000 });
    expect(fs.readdirSync(path.join(vault, 'attachments'))).toHaveLength(1);
  });

  test('the app only serves images from the vault: nothing outside it, nothing hidden, nothing that is not an image', async ({ noted }) => {
    const { win, vault } = noted;
    fs.mkdirSync(path.join(vault, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(vault, '.noted_history'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'attachments', 'ok.png'), PNG);
    fs.writeFileSync(path.join(vault, 'attachments', 'fake.png'), '<script>alert(1)</script>');
    fs.writeFileSync(path.join(vault, '.noted_history', 'secret.png'), PNG);
    const status = (p: string) => win.evaluate(async (u) => (await fetch(u)).status, `app://./${p}`);
    expect(await status('attachments/ok.png')).toBe(200);
    expect(await status('attachments/missing.png')).toBe(404);
    expect(await status('attachments/fake.png')).toBe(404);          // named like an image, is not one
    expect(await status('.noted_history/secret.png')).toBe(404);     // hidden folder
    expect(await status('..%2F..%2Fetc%2Fpasswd')).toBe(404);        // traversal
    expect(await status('attachments%2F..%2F..%2Fetc%2Fhosts')).toBe(404);
  });

  test('old notes with embedded images are moved out from Settings, after a report, with a snapshot', async ({ noted }) => {
    const { win, vault } = noted;
    const before = `<h1>Gamma ideas</h1><p>look <img src="data:image/png;base64,${PNG_B64}"></p>`;
    fs.writeFileSync(path.join(vault, 'Gamma ideas.md'), before);

    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('tab', { name: 'Editor' }).click();
    await win.getByRole('button', { name: /Move embedded images out of notes/ }).click();

    // The report comes first and nothing has changed yet.
    const dialog = win.getByRole('dialog').last();
    await expect(dialog).toContainText('1 embedded image');
    expect(fs.readFileSync(path.join(vault, 'Gamma ideas.md'), 'utf8')).toContain('base64');
    await dialog.getByRole('button', { name: 'Move images' }).click();

    await expect(win.getByRole('status').filter({ hasText: 'Moved 1 image' })).toBeVisible({ timeout: 15_000 });
    const after = fs.readFileSync(path.join(vault, 'Gamma ideas.md'), 'utf8');
    expect(after).not.toContain('base64');
    expect(after).toMatch(/<img src="attachments\/[0-9a-f]{32}\.png">/);
    expect(fs.readdirSync(path.join(vault, 'attachments'))).toHaveLength(1);

    // Reversible: the previous text is in the note's history.
    const hist = path.join(vault, '.noted_history', 'Gamma ideas.md');
    expect(fs.readdirSync(hist).map(f => fs.readFileSync(path.join(hist, f), 'utf8')).some(c => c === before)).toBe(true);
  });

  test('deleting a note offers to remove the images only it used; keeping them leaves the files', async ({ noted }) => {
    const { win, vault } = noted;
    fs.mkdirSync(path.join(vault, 'attachments'));
    fs.writeFileSync(path.join(vault, 'attachments', 'a'.repeat(32) + '.png'), PNG);
    fs.writeFileSync(path.join(vault, 'attachments', 'b'.repeat(32) + '.png'), PNG);
    fs.writeFileSync(path.join(vault, 'Doomed.md'), `<h1>Doomed</h1><p><img src="attachments/${'a'.repeat(32)}.png"><img src="attachments/${'b'.repeat(32)}.png"></p>`);
    fs.writeFileSync(path.join(vault, 'Keeper.md'), `<h1>Keeper</h1><p><img src="attachments/${'b'.repeat(32)}.png"></p>`);
    const { win: w2 } = await noted.relaunch();

    const row = w2.getByRole('button', { name: /^Doomed/ }).first();
    await row.hover();
    // The delete button lives next to the row inside its container; every row has one.
    await row.locator('xpath=..').getByRole('button', { name: 'Delete note' }).click();
    await w2.getByRole('dialog').getByRole('button', { name: 'Delete note' }).click();

    // Only the image nobody else uses is offered.
    const offer = w2.getByRole('dialog');
    await expect(offer).toContainText('1 image');
    await offer.getByRole('button', { name: 'Keep images' }).click();
    expect(fs.existsSync(path.join(vault, 'attachments', 'a'.repeat(32) + '.png'))).toBe(true);
    expect(fs.existsSync(path.join(vault, 'attachments', 'b'.repeat(32) + '.png'))).toBe(true);
    void win;
  });
});
