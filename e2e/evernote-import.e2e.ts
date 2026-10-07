import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// An Evernote export (.enex) into a Markdown vault (#91), through the real Settings → Import button and the real importer; only the file
// picker is answered for the user. Notes land under Evernote/<notebook>, properties and an image are kept, and the report says what did not.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const md5 = (b: Buffer) => crypto.createHash('md5').update(b).digest('hex');

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20201001T000000Z" application="Evernote" version="10.0">
<note><title>Trip plan</title><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><en-note><div>Book the <b>train</b></div><div><en-todo checked="true"/>passports</div><div><en-todo/>hotel</div><div><en-media hash="${md5(PNG)}" type="image/png"/></div></en-note>]]></content><created>20190314T101530Z</created><tag>travel</tag><note-attributes><source-url>https://example.test/trip</source-url></note-attributes><resource><data encoding="base64">${PNG.toString('base64')}</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name></resource-attributes></resource></note>
<note><title>Vault code</title><content><![CDATA[<en-note><div>The code is <en-crypt hint="pet" cipher="RC2" length="128">SECRETBYTES</en-crypt></div></en-note>]]></content></note>
</en-export>`;

test('evernote import: notes, properties, image and a report, from Settings → Import', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Anchor.md'), '# Anchor\n\nhello\n');
  const file = path.join(path.dirname(noted.vault), 'Travel.enex');
  fs.writeFileSync(file, ENEX);

  const { win, app, vault } = await noted.relaunch();
  await expect(win.getByText('Anchor', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as unknown as typeof dialog.showOpenDialog; }, file);

  await win.getByRole('button', { name: 'Settings' }).click();
  await win.getByRole('tab', { name: 'Import' }).click();
  await win.getByRole('button', { name: 'Import from Evernote' }).click();
  await expect(win.getByText(/Successfully imported 2 notes/)).toBeVisible({ timeout: 30_000 });
  await expect(win.getByText(/1 notes have content that did not come across/)).toBeVisible();
  await expect(win.getByText(/Full report: reports\/Evernote import/)).toBeVisible();

  const plan = fs.readFileSync(path.join(vault, 'Evernote/Travel/Trip plan.md'), 'utf8');
  expect(plan).toMatch(/^---\ncreated: 2019-03-14T10:15:30.000Z\ntags:\n {2}- travel\nsource: https:\/\/example.test\/trip\n---\n/);
  expect(plan).toContain('Book the **train**');
  expect(plan).toContain('- [x] passports\n- [ ] hotel');
  const images = fs.readdirSync(path.join(vault, 'attachments'));
  expect(plan).toContain(`![map.png](attachments/${images[0]})`);
  expect(fs.readFileSync(path.join(vault, 'attachments', images[0])).equals(PNG)).toBe(true);

  const secret = fs.readFileSync(path.join(vault, 'Evernote/Travel/Vault code.md'), 'utf8');
  expect(secret).not.toContain('SECRETBYTES');
  const reportName = fs.readdirSync(path.join(vault, 'reports')).find(n => n.startsWith('Evernote import'))!;
  const report = fs.readFileSync(path.join(vault, 'reports', reportName), 'utf8');
  expect(report).toContain('Notes imported: 2');
  expect(report).toContain('**Travel/Vault code**: encrypted text was not imported');

  // The notes are in the app
  await win.keyboard.press('Escape');
  await expect(win.getByText('Trip plan', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});
