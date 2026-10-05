// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { VaultIndex } from './vault-index';
import {
  saveAttachment, readVaultImage, resolveVaultImage, scanEmbeddedImages, migrateEmbeddedImages,
  listOrphanAttachments, deleteAttachments, inlineVaultImages, AttachmentError, type MigrationDeps, type OrphanDeps,
} from './attachments';

const png = (seed: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1, seed + 2, seed + 3]);
const uri = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
const hash = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 32);

let vault: string;
let index: VaultIndex;
let snaps: { name: string; previous: string }[];
let trashed: string[];

const abs = (p: string) => path.join(vault, p);
const write = (p: string, c: string | Uint8Array) => { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), c); };
const read = (p: string) => fs.readFileSync(abs(p), 'utf8');

const deps = (): MigrationDeps & OrphanDeps => ({
  vaultIndex: index,
  readNote: async n => fs.promises.readFile(abs(n), 'utf8'),
  snapshotBefore: async (name, previous) => { snaps.push({ name, previous }); },
  writeNote: async (n, c) => { await fs.promises.writeFile(abs(n), c); index.upsertFromRaw(vault, n, c); },
});

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-att-'));
  index = new VaultIndex({ flushMs: 2 });
  snaps = []; trashed = [];
});
afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

describe('saveAttachment', () => {
  it('stores the image under its content hash and returns the relative path', () => {
    const r = saveAttachment(vault, 'attachments', png(1));
    expect(r).toEqual({ rel: `attachments/${hash(png(1))}.png`, created: true });
    expect(Buffer.compare(fs.readFileSync(abs(r.rel)), Buffer.from(png(1)))).toBe(0);
    expect(fs.readdirSync(abs('attachments'))).toEqual([`${hash(png(1))}.png`]); // no temp file left
  });

  it('stores identical content once, and different content separately', () => {
    const a = saveAttachment(vault, 'attachments', png(1));
    const again = saveAttachment(vault, 'attachments', png(1));
    expect(again).toEqual({ rel: a.rel, created: false });
    expect(saveAttachment(vault, 'attachments', png(9)).rel).not.toBe(a.rel);
    expect(fs.readdirSync(abs('attachments'))).toHaveLength(2);
  });

  it('rejects non-images, empty and oversized input, and bad folder names', () => {
    expect(() => saveAttachment(vault, 'attachments', Buffer.from('<svg/>'))).toThrow(AttachmentError);
    expect(() => saveAttachment(vault, 'attachments', new Uint8Array())).toThrow(/Empty/);
    expect(() => saveAttachment(vault, 'attachments', new Uint8Array(25 * 1024 * 1024 + 1).fill(1))).toThrow(/too large|Not a supported/);
    for (const bad of ['../x', 'a/b', '.hidden', '']) expect(() => saveAttachment(vault, bad, png(1))).toThrow(/folder/);
    expect(fs.existsSync(abs('x'))).toBe(false);
  });

  it('honours a custom folder', () => {
    expect(saveAttachment(vault, 'Pictures', png(2)).rel.startsWith('Pictures/')).toBe(true);
  });
});

describe('readVaultImage / resolveVaultImage (confinement)', () => {
  it('serves a stored image, with the type taken from its bytes', () => {
    const { rel } = saveAttachment(vault, 'attachments', png(3));
    const r = readVaultImage(vault, rel)!;
    expect(r.type.mime).toBe('image/png');
    expect(Buffer.compare(Buffer.from(r.bytes), Buffer.from(png(3)))).toBe(0);
  });

  it('refuses traversal, absolute paths, hidden folders, non-image extensions and missing files', () => {
    write('attachments/ok.png', png(4));
    write('.noted_history/secret.png', png(5));
    write('notes.md', 'x');
    for (const bad of ['../outside.png', 'attachments/../../x.png', '/etc/hosts.png', '.noted_history/secret.png', 'notes.md', 'attachments/nope.png', 'attachments/ok.svg', '%2e%2e/x.png']) {
      expect(readVaultImage(vault, bad), bad).toBeNull();
    }
    expect(readVaultImage(vault, 'attachments/ok.png')).not.toBeNull();
  });

  it('does not serve a file that is named like an image but is not one', () => {
    write('attachments/evil.png', '<script>alert(1)</script>');
    expect(readVaultImage(vault, 'attachments/evil.png')).toBeNull();
  });

  it('does not follow a symlink out of the vault', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'leak.png'), png(7));
      fs.mkdirSync(abs('attachments'));
      fs.symlinkSync(path.join(outside, 'leak.png'), abs('attachments/link.png'));
      expect(resolveVaultImage(vault, 'attachments/link.png')).toBeNull();
      expect(readVaultImage(vault, 'attachments/link.png')).toBeNull();
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

describe('embedded image migration', () => {
  it('dry run reports notes, images, distinct images and bytes without touching anything', async () => {
    write('A.md', `<p><img src="${uri(png(1))}"> <img src="${uri(png(2))}"></p>`);
    write('B.md', `<p><img src="${uri(png(1))}"></p>`); // same image as in A
    write('C.md', '<p>no images</p>');
    const before = [read('A.md'), read('B.md')];
    const report = await scanEmbeddedImages(vault, deps());
    expect(report.notes.map(n => n.name)).toEqual(['A.md', 'B.md']);
    expect(report.images).toBe(3);
    expect(report.distinct).toBe(2);
    expect(report.bytes).toBeGreaterThan(0);
    expect([read('A.md'), read('B.md')]).toEqual(before);
    expect(fs.existsSync(abs('attachments'))).toBe(false);
    expect(snaps).toEqual([]);
  });

  it('moves the images to files, stores duplicates once, rewrites the notes and snapshots what they were', async () => {
    const a = `<p>text <img src="${uri(png(1))}"> more <img alt="x" src="${uri(png(2))}"></p>`;
    write('A.md', a); write('B.md', `<p><img src="${uri(png(1))}"></p>`);
    const out = await migrateEmbeddedImages(vault, 'attachments', deps());
    expect(out).toMatchObject({ notes: 2, images: 3, failed: [] });
    expect(fs.readdirSync(abs('attachments')).sort()).toEqual([`${hash(png(1))}.png`, `${hash(png(2))}.png`].sort());
    expect(read('A.md')).toBe(`<p>text <img src="attachments/${hash(png(1))}.png"> more <img alt="x" src="attachments/${hash(png(2))}.png"></p>`);
    expect(read('B.md')).not.toContain('base64');
    expect(snaps).toContainEqual({ name: 'A.md', previous: a }); // reversible
    // idempotent: nothing left to move
    expect((await scanEmbeddedImages(vault, deps())).images).toBe(0);
    expect(await migrateEmbeddedImages(vault, 'attachments', deps())).toMatchObject({ notes: 0, images: 0 });
  });

  it('keeps an image embedded when its file cannot be written, and still migrates the rest', async () => {
    write('A.md', `<p><img src="${uri(png(1))}"></p>`);
    write('B.md', `<p><img src="${uri(png(2))}"></p>`);
    // a FILE where the attachments folder should be: every save fails
    write('attachments', 'not a directory');
    const out = await migrateEmbeddedImages(vault, 'attachments', deps());
    expect(out.images).toBe(0);
    expect(read('A.md')).toContain('base64'); // untouched
    expect(read('B.md')).toContain('base64');
  });

  it('leaves a data URI that is not a real image alone', async () => {
    const fake = `data:image/png;base64,${Buffer.from('<script>x</script>').toString('base64')}`;
    write('A.md', `<img src="${fake}">`);
    expect(await migrateEmbeddedImages(vault, 'attachments', deps())).toMatchObject({ notes: 0 });
    expect(read('A.md')).toContain(fake);
  });

  it('refuses a bad attachments folder', async () => {
    await expect(migrateEmbeddedImages(vault, '../x', deps())).rejects.toThrow(AttachmentError);
  });
});

describe('orphan attachments', () => {
  const setup = async () => {
    const a = saveAttachment(vault, 'attachments', png(1)).rel;
    const shared = saveAttachment(vault, 'attachments', png(2)).rel;
    const other = saveAttachment(vault, 'attachments', png(3)).rel;
    write('Doomed.md', `<p><img src="${a}"><img src="${shared}"></p>`);
    write('Keeper.md', `<p><img src="${shared}"><img src="${other}"></p>`);
    await index.ensure(vault);
    return { a, shared, other };
  };

  it('lists the images only the deleted note uses', async () => {
    const { a } = await setup();
    expect(await listOrphanAttachments(vault, 'attachments', 'Doomed.md', deps())).toEqual([a]);
  });

  it('does not list a shared image, lists the note\'s own, and finds nothing for a note that uses none', async () => {
    const { other } = await setup();
    expect(await listOrphanAttachments(vault, 'attachments', 'Keeper.md', deps())).toEqual([other]); // `shared` is not
    write('Second.md', `<img src="${other}">`); await index.reconcile(vault);
    expect(await listOrphanAttachments(vault, 'attachments', 'Keeper.md', deps())).toEqual([]);   // now shared too
    write('Plain.md', '<p>nothing</p>'); await index.reconcile(vault);
    expect(await listOrphanAttachments(vault, 'attachments', 'Plain.md', deps())).toEqual([]);
  });

  it('only ever lists files inside the attachments folder', async () => {
    write('elsewhere/pic.png', png(8)); write('Mixed.md', '<p><img src="elsewhere/pic.png"></p>');
    await index.ensure(vault);
    expect(await listOrphanAttachments(vault, 'attachments', 'Mixed.md', deps())).toEqual([]);
  });

  it('is conservative about a note too big to have been indexed: it may still use the image', async () => {
    const small = new VaultIndex({ flushMs: 2, maxParseBytes: 200 });
    const a = saveAttachment(vault, 'attachments', png(1)).rel;
    write('Doomed.md', `<img src="${a}">`);
    write('Huge.md', `<img src="${a}">${'x'.repeat(500)}`); // over the parse cap
    await small.ensure(vault);
    const d = { ...deps(), vaultIndex: small };
    expect(await listOrphanAttachments(vault, 'attachments', 'Doomed.md', d)).toEqual([]);
    write('Huge.md', `no image here ${'x'.repeat(500)}`);
    await small.reconcile(vault);
    expect(await listOrphanAttachments(vault, 'attachments', 'Doomed.md', d)).toEqual([a]);
  });

  it('deleteAttachments re-checks at deletion time and never removes an image still in use', async () => {
    const { a, shared, other } = await setup();
    const trash = async (f: string) => { trashed.push(f); fs.rmSync(f); };
    const out = await deleteAttachments(vault, 'attachments', [a, shared, other, '../x.png', 'attachments/missing.png', 'elsewhere/pic.png'], deps(), trash);
    // a is used by Doomed.md (not yet deleted), shared and other by Keeper.md: nothing is orphaned yet
    expect(out.deleted).toEqual([]);
    expect(trashed).toEqual([]);

    fs.rmSync(abs('Doomed.md')); // the note is deleted
    const out2 = await deleteAttachments(vault, 'attachments', [a, shared], deps(), trash);
    expect(out2.deleted).toEqual([a]);       // only the one nobody uses
    expect(out2.skipped).toEqual([shared]);  // still used by Keeper.md
    expect(fs.existsSync(abs(shared))).toBe(true);
    expect(fs.existsSync(abs(a))).toBe(false);
  });
});

describe('inlineVaultImages (exports)', () => {
  it('embeds stored images so the output stands alone, and leaves anything else alone', () => {
    const { rel } = saveAttachment(vault, 'attachments', png(1));
    const out = inlineVaultImages(vault, `<p><img src="${rel}"><img src="attachments/missing.png"><img src="https://x/a.png"></p>`);
    expect(out).toContain(`src="${uri(png(1))}"`);
    expect(out).toContain('src="attachments/missing.png"');
    expect(out).toContain('src="https://x/a.png"');
    expect(inlineVaultImages(vault, '<p>no images</p>')).toBe('<p>no images</p>');
  });

  it('will not read outside the vault however the path is written', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'x.png'), png(1));
      const html = `<img src="../${path.basename(outside)}/x.png"><img src="${path.join(outside, 'x.png')}">`;
      expect(inlineVaultImages(vault, html)).toBe(html);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});
