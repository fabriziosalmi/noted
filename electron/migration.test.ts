// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { generateVault, coldScan, listNotes } from './test-support/vault-fixture';
import { extractHeadings, localImageRefsOf } from './test-support/index-helpers';
import { planMigration, migrateToMarkdown, migrateToHtml, listNoteFiles, type MigrationDeps, type MigrationProgress } from './migration';
import { readVaultFormat, writeVaultFormat, vaultMarkerPath } from '../shared/vault/formatFile';
import { isLegacyHtml } from '../shared/markdown/migrate';
import { normalizeMarkdown } from '../shared/markdown/codec';

// Conversions of whole vaults, run beside a few hundred other test files: the default 5 s is for single functions.
vi.setConfig({ testTimeout: 120_000 });

const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-migrate-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function depsFor(dir: string, over: Partial<MigrationDeps> = {}): MigrationDeps & { progress: MigrationProgress[] } {
  const progress: MigrationProgress[] = [];
  return {
    dom: { document, DOMParser },
    writeNote: async (name, content) => { fs.writeFileSync(path.join(dir, name), content, 'utf8'); },
    snapshotBefore: async (name, previous) => {
      const hist = path.join(dir, '.noted_history', name);
      fs.mkdirSync(hist, { recursive: true });
      fs.writeFileSync(path.join(hist, `${Date.now()}-${Math.random().toString(36).slice(2)}.html`), previous, 'utf8');
    },
    onProgress: (p) => progress.push(p),
    now: () => new Date(2026, 9, 6, 12, 30, 45),
    ...over,
    progress,
  };
}

const snapshotOfDir = (dir: string): Record<string, string> =>
  Object.fromEntries(listNotes(dir).map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));

/** A vault written by earlier versions: 120 HTML notes with every wikilink form, tags, frontmatter, folders. */
function legacyVault(count = 120): string {
  const dir = tmp();
  generateVault(dir, { count, seed: 7 });
  return dir;
}

describe('listNoteFiles', () => {
  it('lists notes in folders, skipping hidden folders, other files and links', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'Sub'));
    fs.mkdirSync(path.join(dir, '.noted_history', 'X.md'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'B.md'), 'b');
    fs.writeFileSync(path.join(dir, 'a.MD'), 'a');
    fs.writeFileSync(path.join(dir, 'Sub', 'C.md'), 'c');
    fs.writeFileSync(path.join(dir, 'pic.png'), 'x');
    fs.writeFileSync(path.join(dir, '.noted_history', 'X.md', '1.md'), 'hidden');
    expect(await listNoteFiles(dir)).toEqual(['B.md', 'Sub/C.md', 'a.MD']);
  });
});

describe('planMigration (dry run)', () => {
  it('reports what would happen and touches nothing', async () => {
    const dir = legacyVault();
    fs.writeFileSync(path.join(dir, 'Already.md'), '# Already\n\nMarkdown.\n');
    fs.writeFileSync(path.join(dir, 'Empty.md'), '');
    const before = snapshotOfDir(dir);
    const report = await planMigration(dir, depsFor(dir));
    expect(report.total).toBe(Object.keys(before).length);
    expect(report.skip).toBe(2);
    expect(report.convert).toBe(report.total - 2);
    expect(report.failed).toBe(0);
    expect(Object.values(report.verdicts).reduce((a, b) => a + b, 0)).toBe(report.convert);
    expect(snapshotOfDir(dir)).toEqual(before);
    expect(fs.existsSync(path.join(dir, '.noted'))).toBe(false);
    expect(readVaultFormat(dir)).toBe('html');
  });
});

describe('migrateToMarkdown', () => {
  it('converts every note, and what the index sees is the same afterwards', async () => {
    const dir = legacyVault();
    const links = coldScan(dir);
    const headings = Object.fromEntries(listNotes(dir).map((n) => [n, extractHeadings(fs.readFileSync(path.join(dir, n), 'utf8')).map((h) => `${h.level}:${h.text}`)]));
    const result = await migrateToMarkdown(dir, depsFor(dir));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect(readVaultFormat(dir)).toBe('markdown');
    for (const n of listNotes(dir)) expect(isLegacyHtml(fs.readFileSync(path.join(dir, n), 'utf8')), n).toBe(false);
    // the same links and tags in every note, the same headings
    expect(coldScan(dir)).toEqual(links);
    const after = Object.fromEntries(listNotes(dir).map((n) => [n, extractHeadings(fs.readFileSync(path.join(dir, n), 'utf8')).map((h) => `${h.level}:${h.text}`)]));
    expect(after).toEqual(headings);
    // and each note is stable: saving it again changes nothing
    for (const n of listNotes(dir)) {
      const text = fs.readFileSync(path.join(dir, n), 'utf8');
      expect(normalizeMarkdown(text), n).toBe(text);
    }
    expect(result.converted).toBe(listNotes(dir).length);
    expect(fs.existsSync(path.join(dir, '.noted', 'migration.lock'))).toBe(false);
  });

  it('keeps a verified copy of every note, and each note\'s old text in its history', async () => {
    const dir = legacyVault(40);
    const original = snapshotOfDir(dir);
    const result = await migrateToMarkdown(dir, depsFor(dir));
    if (!result.ok) throw new Error(result.reason);
    expect(path.basename(result.backup)).toBe('notes-before-markdown-20261006-123045.zip');
    const zip = await JSZip.loadAsync(fs.readFileSync(result.backup));
    for (const [name, text] of Object.entries(original)) {
      expect(await zip.file(name)!.async('string'), name).toBe(text);
      const hist = path.join(dir, '.noted_history', name);
      expect(fs.readdirSync(hist).map((f) => fs.readFileSync(path.join(hist, f), 'utf8')), name).toContain(text);
    }
  });

  it('refuses a vault that is already Markdown, and can be run again after an interruption', async () => {
    const dir = legacyVault(30);
    const names = listNotes(dir);
    // an earlier run died half way: some notes are already Markdown, the marker never changed
    const first = await migrateToMarkdown(dir, depsFor(dir));
    if (!first.ok) throw new Error(first.reason);
    const done = snapshotOfDir(dir);
    expect((await migrateToMarkdown(dir, depsFor(dir))).ok).toBe(false);
    writeVaultFormat(dir, 'html'); // as if the marker write never happened
    const again = await migrateToMarkdown(dir, depsFor(dir));
    expect(again.ok, JSON.stringify(again)).toBe(true);
    if (again.ok) { expect(again.converted).toBe(0); expect(again.report.skip).toBe(names.length); }
    expect(snapshotOfDir(dir)).toEqual(done);
    expect(readVaultFormat(dir)).toBe('markdown');
  });

  it('leaves notes that are already Markdown byte for byte as they are', async () => {
    const dir = legacyVault(20);
    const odd = '---\ntitle:   spaced\n---\n\n#   Odd   heading\n\n*   star bullet\n';
    fs.writeFileSync(path.join(dir, 'Odd.md'), odd);
    const result = await migrateToMarkdown(dir, depsFor(dir));
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'Odd.md'), 'utf8')).toBe(odd);
  });

  it('puts every note back exactly as it was when a write fails, and keeps the vault in HTML', async () => {
    const dir = legacyVault(40);
    const original = snapshotOfDir(dir);
    let writes = 0;
    const result = await migrateToMarkdown(dir, depsFor(dir, {
      writeNote: async (name, content) => {
        // the 15th write of the conversion fails; the restores that follow must be allowed through
        if (content.startsWith('<') === false && ++writes === 15) throw new Error('disk full');
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
      },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/every note was restored: disk full/);
    expect(snapshotOfDir(dir)).toEqual(original);
    expect(readVaultFormat(dir)).toBe('html');
    expect(fs.existsSync(path.join(dir, '.noted', 'migration.lock'))).toBe(false);
  });

  it('puts everything back when a write reads back differently', async () => {
    const dir = legacyVault(20);
    const original = snapshotOfDir(dir);
    let n = 0;
    const result = await migrateToMarkdown(dir, depsFor(dir, {
      writeNote: async (name, content) => {
        fs.writeFileSync(path.join(dir, name), content.startsWith('<') ? content : (++n === 5 ? content + 'tampered' : content), 'utf8');
      },
    }));
    expect(result.ok).toBe(false);
    expect(snapshotOfDir(dir)).toEqual(original);
    expect(readVaultFormat(dir)).toBe('html');
  });

  it('converts a note an outside writer saved in the old format while it ran', async () => {
    const dir = legacyVault(20);
    let injected = false;
    const result = await migrateToMarkdown(dir, depsFor(dir, {
      writeNote: async (name, content) => {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
        if (!injected && !content.startsWith('<')) {
          injected = true;
          fs.writeFileSync(path.join(dir, 'Late arrival.md'), '<h1>Late</h1><p>from another device #late</p>');
        }
      },
    }));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'Late arrival.md'), 'utf8')).toBe('# Late\n\nfrom another device #late\n');
  });

  it('will not start while another conversion holds the lock, and takes over a stale one', async () => {
    const dir = legacyVault(10);
    fs.mkdirSync(path.join(dir, '.noted'), { recursive: true });
    const lock = path.join(dir, '.noted', 'migration.lock');
    fs.writeFileSync(lock, '{}');
    const blocked = await migrateToMarkdown(dir, depsFor(dir));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toMatch(/already running/);
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    expect((await migrateToMarkdown(dir, depsFor(dir))).ok).toBe(true);
  });

  it('reports progress through every phase', async () => {
    const dir = legacyVault(25);
    const deps = depsFor(dir);
    await migrateToMarkdown(dir, deps);
    expect([...new Set(deps.progress.map((p) => p.phase))]).toEqual(['scan', 'convert', 'backup', 'write', 'convert', 'finish'].filter((p, i, a) => a.indexOf(p) === i));
  });
});

describe('migrateToHtml (the way back)', () => {
  it('returns the vault to HTML with the same links, tags and headings, and can go forward again', async () => {
    const dir = legacyVault(60);
    const links = coldScan(dir);
    const forward = await migrateToMarkdown(dir, depsFor(dir));
    if (!forward.ok) throw new Error(forward.reason);
    const markdown = snapshotOfDir(dir);

    const back = await migrateToHtml(dir, depsFor(dir, { now: () => new Date(2026, 9, 6, 12, 31, 0) }));
    expect(back.ok, JSON.stringify(back)).toBe(true);
    expect(readVaultFormat(dir)).toBe('html');
    for (const n of listNotes(dir)) expect(isLegacyHtml(fs.readFileSync(path.join(dir, n), 'utf8')) || fs.readFileSync(path.join(dir, n), 'utf8') === '', n).toBe(true);
    expect(coldScan(dir)).toEqual(links);

    // forward once more: the Markdown is what it was
    const again = await migrateToMarkdown(dir, depsFor(dir, { now: () => new Date(2026, 9, 6, 12, 32, 0) }));
    expect(again.ok).toBe(true);
    expect(snapshotOfDir(dir)).toEqual(markdown);
    expect(fs.existsSync(vaultMarkerPath(dir))).toBe(true);
  });
});

describe('what the report says about images', () => {
  it('keeps every local image reference', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'attachments'));
    fs.writeFileSync(path.join(dir, 'A.md'), '<h1>A</h1><img src="attachments/0123456789abcdef0123456789abcdef.png"><p>x <img src="attachments/fedcba9876543210fedcba9876543210.png"> y</p>');
    const before = localImageRefsOf(fs.readFileSync(path.join(dir, 'A.md'), 'utf8'));
    const result = await migrateToMarkdown(dir, depsFor(dir));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(localImageRefsOf(fs.readFileSync(path.join(dir, 'A.md'), 'utf8'))).toEqual(before);
  });
});
