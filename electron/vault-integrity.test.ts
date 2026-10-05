// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from './vault-index';
import { applyRewrite, type RewriteDeps } from './link-rewrite';
import { deleteFolderMovingContentToRoot } from './vault-ops';
import { generateVault, coldScan, danglingTargets, listNotes, rng, type GeneratedVault } from './test-support/vault-fixture';

/**
 * Vault-integrity regression suite on a 500-note vault. Whatever the app does to
 * the vault — rename, move, folder rename/delete, delete and restore, edits made
 * outside the app, a restart — two things must hold:
 *   1. the live VaultIndex equals an index rebuilt from scratch from the files;
 *   2. the operations the app performs on notes never leave a link dangling that
 *      was not dangling before.
 */

const COUNT = 500;
let dir: string;
let index: VaultIndex;
let gen: GeneratedVault;
let baselineTargets: Set<string>;
/** Link targets that are allowed to dangle because a note was deleted on purpose. */
let deletedTargets: Set<string>;
const abs = (n: string) => path.join(dir, n);
const bare = (n: string) => n.replace(/\.md$/, '');

const deps = (): RewriteDeps => ({
  vaultIndex: index,
  readNote: async n => fs.promises.readFile(abs(n), 'utf8'),
  snapshotBefore: async () => undefined,
  writeNote: async (n, c) => { await fs.promises.writeFile(abs(n), c); index.upsertFromRaw(dir, n, c); },
});

// ── what the app does ───────────────────────────────────────────────────────

async function appRename(from: string, to: string) {
  fs.mkdirSync(path.dirname(abs(to)), { recursive: true });
  fs.renameSync(abs(from), abs(to));
  index.renameDoc(dir, from, to);
  await applyRewrite(dir, [{ from, to }], deps());
}

async function appRenameFolder(oldName: string, newName: string) {
  const renames = listNotes(dir).filter(n => n.startsWith(`${oldName}/`)).map(n => ({ from: n, to: `${newName}/${n.slice(oldName.length + 1)}` }));
  fs.renameSync(abs(oldName), abs(newName));
  await index.reconcile(dir);
  await applyRewrite(dir, renames, deps());
}

async function appDeleteFolder(name: string) {
  const { moves } = deleteFolderMovingContentToRoot(dir, name, (d, rel) => path.join(d, rel));
  await index.reconcile(dir);
  await applyRewrite(dir, moves, deps());
}

function appDelete(name: string): string {
  const content = fs.readFileSync(abs(name), 'utf8');
  fs.unlinkSync(abs(name));
  index.deleteDoc(dir, name);
  deletedTargets.add(bare(name));
  return content;
}

function restore(name: string, content: string) {
  fs.mkdirSync(path.dirname(abs(name)), { recursive: true });
  fs.writeFileSync(abs(name), content);
  index.upsertFromRaw(dir, name, content);
  deletedTargets.delete(bare(name));
}

async function externalEdit(name: string, html: string) {
  fs.writeFileSync(abs(name), html);
  fs.utimesSync(abs(name), new Date(Date.now() + 10_000 + Math.floor(Math.random() * 1000)), new Date(Date.now() + 10_000));
  await index.touch(dir, name);
}

// ── the invariants ──────────────────────────────────────────────────────────

async function expectIntegrity(label: string) {
  await index.flushNow(dir);
  const live = await index.snapshot(dir);
  const cold = coldScan(dir);
  expect(Object.keys(live.notes).sort(), `${label}: same notes`).toEqual(Object.keys(cold).sort());
  for (const [name, c] of Object.entries(cold)) {
    expect(live.notes[name].links, `${label}: links of ${name}`).toEqual(c.links);
    expect(live.notes[name].tags, `${label}: tags of ${name}`).toEqual(c.tags);
  }
  // …and a brand-new index (a restart) agrees too.
  const fresh = await new VaultIndex({ flushMs: 2 }).snapshot(dir);
  expect(fresh.notes, `${label}: restart`).toEqual(live.notes);
}

const norm = (t: string) => t.replace(/\.md$/i, '').toLowerCase(); // links match case-insensitively

function expectNoNewDanglingLinks(label: string) {
  const known = new Set([...baselineTargets, ...deletedTargets].map(norm));
  const extra = danglingTargets(dir).filter(t => !known.has(norm(t)));
  expect(extra, `${label}: links left dangling`).toEqual([]);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-integrity-'));
  gen = generateVault(dir, { count: COUNT, seed: 7 });
  baselineTargets = new Set(danglingTargets(dir));
  deletedTargets = new Set();
  index = new VaultIndex({ flushMs: 2 });
  await index.ensure(dir);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe(`vault integrity (${COUNT} notes)`, { timeout: 120_000 }, () => {
  it('the fixture is what the suite claims: 500 notes, folders, every link form, and some links to nothing', () => {
    expect(listNotes(dir)).toHaveLength(gen.names.length);
    expect(gen.names.length).toBeGreaterThanOrEqual(COUNT - 5); // a few name collisions are skipped
    expect(new Set(gen.names.map(n => n.includes('/') ? n.split('/')[0] : '')).size).toBeGreaterThanOrEqual(4);
    expect(baselineTargets.size).toBeGreaterThan(0);
    const all = gen.names.map(n => fs.readFileSync(abs(n), 'utf8')).join('\n');
    for (const form of ['|see ', '#Details]]', '.md]]', 'data-wikilink="', '&amp;']) expect(all, form).toContain(form);
  });

  it('starts consistent: the index built at startup equals a cold rescan', async () => {
    await expectIntegrity('startup');
  });

  it('renaming notes rewrites every inbound link: no new dangling link, index == cold rescan', async () => {
    const rand = rng(11);
    const notes = listNotes(dir);
    for (let i = 0; i < 30; i++) {
      const from = notes[Math.floor(rand() * notes.length)];
      if (!fs.existsSync(abs(from))) continue;
      const folder = from.includes('/') ? from.split('/')[0] + '/' : '';
      await appRename(from, `${folder}Renamed ${i} & co.md`);
    }
    expectNoNewDanglingLinks('after renames');
    await expectIntegrity('after renames');
  });

  it('moving notes between folders keeps every link valid', async () => {
    const rand = rng(12);
    const notes = listNotes(dir);
    for (let i = 0; i < 30; i++) {
      const from = notes[Math.floor(rand() * notes.length)];
      if (!fs.existsSync(abs(from))) continue;
      const base = from.split('/').pop()!;
      const to = `${['', 'Projects', 'Archive', 'Meetings', 'Ideas'][Math.floor(rand() * 5)]}/${base}`.replace(/^\//, '');
      if (to === from || fs.existsSync(abs(to))) continue;
      await appRename(from, to);
    }
    expectNoNewDanglingLinks('after moves');
    await expectIntegrity('after moves');
  });

  it('renaming a folder and deleting a folder (its notes move to the root) keep every link valid', async () => {
    await appRenameFolder('Projects', 'Work');
    expectNoNewDanglingLinks('after folder rename');
    await expectIntegrity('after folder rename');
    await appDeleteFolder('Meetings');
    expectNoNewDanglingLinks('after folder delete');
    await expectIntegrity('after folder delete');
    expect(listNotes(dir).some(n => n.startsWith('Meetings/'))).toBe(false);
  });

  it('delete and restore: links to a deleted note dangle only while it is gone, and resolve again when it returns', async () => {
    const rand = rng(13);
    const notes = listNotes(dir);
    const removed: { name: string; content: string }[] = [];
    for (let i = 0; i < 25; i++) {
      const name = notes[Math.floor(rand() * notes.length)];
      if (fs.existsSync(abs(name))) removed.push({ name, content: appDelete(name) });
    }
    expectNoNewDanglingLinks('while deleted');
    await expectIntegrity('while deleted');
    for (const { name, content } of removed) restore(name, content);
    expect(danglingTargets(dir).filter(t => !new Set([...baselineTargets].map(norm)).has(norm(t)))).toEqual([]); // everything resolves again
    await expectIntegrity('after restore');
  });

  it('edits made outside the app (links and tags added, removed, files created) are all reflected', async () => {
    const rand = rng(14);
    const notes = listNotes(dir);
    for (let i = 0; i < 40; i++) {
      const name = notes[Math.floor(rand() * notes.length)];
      const target = bare(notes[Math.floor(rand() * notes.length)]);
      await externalEdit(name, `<h1>${bare(name)}</h1><p>edited outside: [[${target.replace(/&/g, '&amp;')}]] #external${i % 5} #idea</p>`);
    }
    for (let i = 0; i < 10; i++) {
      const name = `External ${i}.md`;
      fs.writeFileSync(abs(name), `<p>new from outside #fresh [[${bare(notes[i])}]]</p>`);
      await index.touch(dir, name);
    }
    for (let i = 0; i < 10; i++) { const n = notes[i * 7]; if (fs.existsSync(abs(n))) { fs.unlinkSync(abs(n)); await index.touch(dir, n); deletedTargets.add(bare(n)); } }
    await expectIntegrity('after external edits');
  });

  it('survives a restart in the middle of a session: a fresh index after many operations equals the live one', async () => {
    const rand = rng(15);
    const notes = listNotes(dir);
    for (let i = 0; i < 15; i++) {
      const from = notes[Math.floor(rand() * notes.length)];
      if (fs.existsSync(abs(from))) await appRename(from, `${from.includes('/') ? from.split('/')[0] + '/' : ''}Session ${i}.md`);
    }
    await expectIntegrity('before restart');
    // restart: a new process starts with a new index over the same files
    const restarted = new VaultIndex({ flushMs: 2 });
    index = restarted;
    await index.ensure(dir);
    await expectIntegrity('after restart');
    expectNoNewDanglingLinks('after restart');
  });

  it('a long mixed session (renames, moves, edits, deletes, restores, a folder rename) never breaks either invariant', async () => {
    const rand = rng(16);
    const parked: { name: string; content: string }[] = [];
    let ops = 0;
    for (let step = 0; step < 120; step++) {
      const notes = listNotes(dir);
      const name = notes[Math.floor(rand() * notes.length)];
      const r = rand();
      if (r < 0.3) {
        await appRename(name, `${name.includes('/') ? name.split('/')[0] + '/' : ''}Mixed ${step}.md`);
      } else if (r < 0.5) {
        const to = `${['', 'Projects', 'Archive', 'Ideas'][Math.floor(rand() * 4)]}/${name.split('/').pop()}`.replace(/^\//, '');
        if (to !== name && !fs.existsSync(abs(to))) await appRename(name, to);
      } else if (r < 0.7) {
        await externalEdit(name, `<h1>${bare(name)}</h1><p>mixed ${step} [[${bare(notes[Math.floor(rand() * notes.length)])}]] #m${step % 4}</p>`);
      } else if (r < 0.8) {
        parked.push({ name, content: appDelete(name) });
      } else if (r < 0.9 && parked.length) {
        const p = parked.pop()!;
        if (!fs.existsSync(abs(p.name))) restore(p.name, p.content);
      } else if (step === 60 && fs.existsSync(abs('Projects'))) {
        await appRenameFolder('Projects', 'Work');
      }
      ops++;
      if (step % 10 === 9) { expectNoNewDanglingLinks(`step ${step}`); await expectIntegrity(`step ${step}`); }
    }
    expect(ops).toBe(120);
    await expectIntegrity('end of session');
  }, 120_000);
});
