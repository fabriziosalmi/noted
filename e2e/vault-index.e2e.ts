import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// Links and tags come from the main-process vault index, so they must be right
// after a restart (no note opened yet) and follow edits made outside the app.

const NOTES: [string, string][] = [
  ['Hub.md', '<h1>Hub</h1><p>talks to [[Spoke]] #alpha</p>'],
  ['Spoke.md', '<h1>Spoke</h1><p>#beta</p>'],
  ['Satellite.md', '<h1>Satellite</h1><p>[[spoke|an alias]] and [[Spoke#Setup]]</p>'],
];

test.describe('vault index', () => {
  test('tags and backlinks are complete after a restart, without opening any note first', async ({ noted }) => {
    for (const [name, html] of NOTES) fs.writeFileSync(path.join(noted.vault, name), html);
    const again = await noted.relaunch();
    const { win } = again;

    // The tag filter exists only when the index knows tags: no note was opened.
    await win.getByRole('button', { name: 'Tags' }).click();
    await expect(win.getByRole('button', { name: '#alpha', exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: '#beta', exact: true })).toBeVisible();

    // Filtering by a tag lists exactly the notes that carry it.
    await win.getByRole('button', { name: '#beta', exact: true }).click();
    await expect(win.getByText('Spoke', { exact: true }).first()).toBeVisible();
    await expect(win.getByText('Hub', { exact: true })).toHaveCount(0);
    await win.getByRole('button', { name: '#beta', exact: true }).click(); // clear the filter

    // Backlinks include the aliased and heading forms, case-insensitively.
    await win.getByText('Spoke', { exact: true }).first().click();
    await expect(win.getByRole('button', { name: '[[Hub]]' })).toBeVisible();
    await expect(win.getByRole('button', { name: '[[Satellite]]' })).toBeVisible();
  });

  test('a note written or removed outside the app updates tags without any user action', async ({ noted }) => {
    const { win, vault } = noted;
    fs.writeFileSync(path.join(vault, 'Outside.md'), '<h1>Outside</h1><p>#gamma</p>');
    await win.getByRole('button', { name: 'Tags' }).click({ timeout: 15_000 });
    await expect(win.getByRole('button', { name: '#gamma', exact: true })).toBeVisible({ timeout: 15_000 });

    fs.unlinkSync(path.join(vault, 'Outside.md'));
    await expect(win.getByRole('button', { name: '#gamma', exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
});
