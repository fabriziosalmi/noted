import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, SEED_NOTES } from './fixtures';

const MOD = 'ControlOrMeta';

// Converting a vault written by earlier versions (HTML in .md files) to Markdown and back, on the real app.
// These tests drive the IPC directly; the Settings screen on top of it is in markdown-conversion-ui.e2e.ts.
const FRONTMATTER = encodeURIComponent('---\ntitle: Hub\nstatus: draft\n---');
const LEGACY: [string, string][] = [
  ['Hub.md', `<!--noted-frontmatter:${FRONTMATTER}-->\n<h1>Hub</h1><p>Talks to [[Spoke]] and <span data-wikilink="Satellite" class="wikilink" role="link">[[Satellite|the sat]]</span> #alpha</p><ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>first task</p></div></li></ul>`],
  ['Spoke.md', '<h1>Spoke</h1><p>A plain note with <strong>bold</strong> and <code>code</code>. #beta</p><table><tbody><tr><th><p>Name</p></th><th><p>Qty</p></th></tr><tr><td><p>Apple</p></td><td><p>3</p></td></tr></tbody></table>'],
  ['Satellite.md', '<h1>Satellite</h1><p>See [[Spoke#Setup]]. E = mc<sup>2</sup></p>'],
];

interface Plan { success: boolean; data?: { total: number; convert: number; skip: number; failed: number; verdicts: Record<string, number> } }

async function legacyVault(noted: Parameters<Parameters<typeof test>[2]>[0]['noted']) {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  for (const [name, html] of LEGACY) fs.writeFileSync(path.join(noted.vault, name), html);
  return noted.relaunch();
}

const call = <T>(win: Page, body: string): Promise<T> =>
  win.evaluate(`(async () => { const api = window.electronAPI; ${body} })()`) as Promise<T>;

test.describe('converting a vault', () => {
  test('a dry run changes nothing and says what would happen', async ({ noted }) => {
    const { win, vault } = await legacyVault(noted);
    const before = Object.fromEntries(fs.readdirSync(vault).filter(f => f.endsWith('.md')).map(f => [f, fs.readFileSync(path.join(vault, f), 'utf8')]));
    const plan = await call<Plan>(win, "return api.migrationPlan('to-markdown');");
    expect(plan.success).toBe(true);
    expect(plan.data).toMatchObject({ total: 3, convert: 3, skip: 0, failed: 0 });
    expect(plan.data!.verdicts.raw).toBe(1); // the <sup>
    expect(Object.fromEntries(fs.readdirSync(vault).filter(f => f.endsWith('.md')).map(f => [f, fs.readFileSync(path.join(vault, f), 'utf8')]))).toEqual(before);
    expect(fs.existsSync(path.join(vault, '.noted-vault.json'))).toBe(false);
  });

  test('converts to Markdown: notes, tags and backlinks intact, the app keeps working, history keeps the old text', async ({ noted }) => {
    const { win, vault } = await legacyVault(noted);
    // open a note first: the app must follow the change under its feet
    await win.getByText('Hub', { exact: true }).first().click();
    await expect(win.locator('[contenteditable="true"]').first().locator('h1')).toHaveText('Hub');

    const result = await call<{ ok: boolean; reason?: string; converted?: number; backup?: string }>(win, 'return api.migrationApply({});');
    expect(result.ok, result.reason).toBe(true);
    expect(result.converted).toBe(3);
    expect(fs.existsSync(result.backup!)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(vault, '.noted-vault.json'), 'utf8')).format).toBe('markdown');

    const hub = fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8');
    expect(hub).toBe('---\ntitle: Hub\nstatus: draft\n---\n\n# Hub\n\nTalks to [[Spoke]] and [[Satellite|the sat]] #alpha\n\n- [ ] first task\n');
    expect(fs.readFileSync(path.join(vault, 'Spoke.md'), 'utf8')).toBe('# Spoke\n\nA plain note with **bold** and `code`. #beta\n\n| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n');
    expect(fs.readFileSync(path.join(vault, 'Satellite.md'), 'utf8')).toBe('# Satellite\n\nSee [[Spoke#Setup]]. E = mc<sup>2</sup>\n');

    // the open note is still shown, and editing it now writes Markdown
    const editor = win.locator('[contenteditable="true"]').first();
    await expect(editor.locator('h1')).toHaveText('Hub', { timeout: 15_000 });
    await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(1);
    await editor.click();
    await win.keyboard.press(`${MOD}+End`);
    await win.keyboard.type(' after-conversion');
    await expect.poll(() => fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8'), { timeout: 15_000 }).toContain('after-conversion');
    expect(fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8')).not.toMatch(/<(p|h1|ul|li)\b/);

    // tags and backlinks come from the index, which saw the new files
    await win.getByRole('button', { name: 'Tags' }).click();
    await expect(win.getByRole('button', { name: '#alpha', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(win.getByRole('button', { name: '#beta', exact: true })).toBeVisible();

    // each note's previous text is in its history, readable from the app
    const history = await call<{ hasOld: boolean }>(win, `
      const list = await api.getNoteHistory('Spoke.md');
      for (const s of list.data ?? []) { const r = await api.readNoteSnapshot('Spoke.md', s.name); if (r.data && r.data.includes('<strong>bold</strong>')) return { hasOld: true }; }
      return { hasOld: false };`);
    expect(history.hasOld).toBe(true);
  });

  test('can be undone: back to HTML, same notes, and forward again', async ({ noted }) => {
    const { win, vault } = await legacyVault(noted);
    expect((await call<{ ok: boolean }>(win, 'return api.migrationApply({});')).ok).toBe(true);
    const markdown = fs.readFileSync(path.join(vault, 'Spoke.md'), 'utf8');

    const back = await call<{ ok: boolean; reason?: string }>(win, 'return api.migrationRevert();');
    expect(back.ok, back.reason).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(vault, '.noted-vault.json'), 'utf8')).format).toBe('html');
    expect(fs.readFileSync(path.join(vault, 'Spoke.md'), 'utf8')).toMatch(/^<h1>Spoke<\/h1>/);
    // the app reads the HTML vault again
    await win.getByText('Spoke', { exact: true }).first().click();
    await expect(win.locator('[contenteditable="true"]').first().locator('strong')).toHaveText('bold');

    const forward = await call<{ ok: boolean; reason?: string }>(win, 'return api.migrationApply({});');
    expect(forward.ok, forward.reason).toBe(true);
    expect(fs.readFileSync(path.join(vault, 'Spoke.md'), 'utf8')).toBe(markdown);
  });

  test('a second conversion of a converted vault is refused, and nothing changes', async ({ noted }) => {
    const { win, vault } = await legacyVault(noted);
    await call(win, 'return api.migrationApply({});');
    const files = fs.readdirSync(vault).filter(f => f.endsWith('.md')).map(f => fs.readFileSync(path.join(vault, f), 'utf8'));
    const again = await call<{ ok: boolean; reason?: string }>(win, 'return api.migrationApply({});');
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/already stored as Markdown/);
    expect(fs.readdirSync(vault).filter(f => f.endsWith('.md')).map(f => fs.readFileSync(path.join(vault, f), 'utf8'))).toEqual(files);
  });
});
