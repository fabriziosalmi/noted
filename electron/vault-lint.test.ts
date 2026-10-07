// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from './vault-index';
import { FullTextSearchReadModel } from './fulltext-index';
import { lintVaultDir } from './vault-lint';

// The health check on a real vault, read through the real indexes: what the app resolves, the app's own idea of a heading,
// aliases, frontmatter.
const NOW = Date.UTC(2026, 9, 7);
const DAY = 86_400_000;
let dir: string;
const write = (rel: string, text: string, ageDays = 1) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const when = new Date(NOW - ageDays * DAY);
  fs.utimesSync(file, when, when);
};
const check = async (opts = {}) => lintVaultDir(dir, { vaultIndex: new VaultIndex({ flushMs: 2 }), fullText: new FullTextSearchReadModel(), validate: () => undefined }, opts, NOW);
const long = (seed: string) => Array.from({ length: 220 }, (_, i) => `${seed}${i}`).join(' ');

beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-lint-'))); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('lintVaultDir', () => {
  it('finds, in a real vault, what each check is for', async () => {
    fs.writeFileSync(path.join(dir, '.noted-vault.json'), '{"format":"markdown"}');
    write('Hub.md', '# Hub\n\nSee [[Work/Plan]], [[Plan#Risks]], [[Plan#Missing heading]], [[Quartely Report]], [[Gone]], and [[Roadmap]].\n');
    write('Work/Plan.md', '---\naliases: [Roadmap]\nsummary: The plan.\n---\n# Plan\n\n## Risks\n\nSlips.\n\nBack to [[Hub]].\n');
    write('Quarterly Report.md', `# Quarterly Report\n\n${long('q')}\n\nLinked from [[Hub]].\n`);
    write('Alone.md', 'A note about nothing that anyone links to, with some words in it.\n');
    write('Copy A.md', 'The very same paragraph of text that appears in two places in this vault, word for word.\n', 5);
    write('Copy B.md', 'The very same paragraph of text that appears in two places in this vault, word for word.\n', 1);
    write('Old.md', 'Written long ago and never touched since, linking to [[Hub]].\n', 800);
    write('Blank.md', '---\ntitle: nothing\n---\n');
    write('Work/Notes.md', 'Meeting\n[[Hub]]\n');
    write('Home/Notes.md', 'Different content about the home.\n[[Hub]]\n');

    const r = await check();
    expect(r.notes).toBe(10);
    const f = (kind: string) => r.findings.filter(x => x.kind === kind);

    // Links resolve as the app resolves them: by path, by bare name, by alias; the typo gets a suggestion
    expect(f('broken-link').map(x => [(x as { target: string }).target, (x as { suggestion: string | null }).suggestion])).toEqual([
      ['Quartely Report', 'Quarterly Report.md'],
      ['Gone', null],
    ]);
    // Headings are the ones the note really has
    expect(f('broken-heading').map(x => (x as { heading: string }).heading)).toEqual(['Missing heading']);

    expect(f('isolated').map(x => (x as { note: string }).note)).toEqual(['Alone.md', 'Blank.md', 'Copy A.md', 'Copy B.md']);
    expect(f('duplicate')).toEqual([expect.objectContaining({ notes: ['Copy A.md', 'Copy B.md'] })]);
    expect(f('same-name')).toEqual([expect.objectContaining({ notes: ['Home/Notes.md', 'Work/Notes.md'] })]);
    expect(f('stale').map(x => (x as { note: string }).note)).toEqual(['Old.md']);
    expect(f('empty').map(x => (x as { note: string }).note)).toEqual(['Blank.md']);
    // Long, and no summary property: only the quarterly report (the plan has one, the rest are short)
    expect(f('no-summary').map(x => (x as { note: string }).note)).toEqual(['Quarterly Report.md']);
  });

  it('follows the vault as it changes: fix a link and it is no longer broken', async () => {
    fs.writeFileSync(path.join(dir, '.noted-vault.json'), '{"format":"markdown"}');
    write('A.md', 'Link to [[Typo]] here.\n');
    write('Real.md', 'Linking back to [[A]].\n');
    expect((await check()).counts['broken-link']).toBe(1);
    write('A.md', 'Link to [[Real]] here.\n');
    expect((await check()).counts['broken-link']).toBe(0);
  });

  it('the staleness threshold is a choice', async () => {
    fs.writeFileSync(path.join(dir, '.noted-vault.json'), '{"format":"markdown"}');
    write('A.md', 'Some words here.\n[[B]]\n', 100);
    write('B.md', 'Other words.\n[[A]]\n', 10);
    expect((await check()).counts.stale).toBe(0);
    expect((await check({ staleDays: 30 })).counts.stale).toBe(1);
  });

  it('an empty vault is a healthy one', async () => {
    expect(await check()).toMatchObject({ notes: 0, findings: [] });
  });

  it('a vault that is still HTML is checked the same way', async () => {
    write('A.md', '<h1>A</h1><p>See <span data-wikilink="Nowhere">[[Nowhere]]</span></p>');
    write('B.md', '<h1>B</h1><p>text</p>');
    const r = await check();
    expect(r.notes).toBe(2);
    expect(r.counts.isolated).toBeGreaterThanOrEqual(1);
  });
});
