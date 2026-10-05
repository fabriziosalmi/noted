import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';
import { generateVault, coldScan, danglingTargets, listNotes, rng } from '../electron/test-support/vault-fixture';

// The same two invariants as electron/vault-integrity.test.ts, on the REAL app:
// whatever it does to a 500-note vault, the live index equals a cold rescan,
// and renames/moves never leave a link dangling. Operations go through the same
// IPC calls the UI makes.

interface Api {
  renameNote: (a: string, b: string, d?: string, o?: { updateLinks?: boolean }) => Promise<{ success: boolean; error?: string }>;
  moveNote: (f: string, to: string, d?: string, o?: { updateLinks?: boolean }) => Promise<{ success: boolean; data?: string; error?: string }>;
  getVaultIndexSnapshot: (d?: string) => Promise<{ notes: Record<string, { links: string[]; tags: string[] }> }>;
}

const norm = (t: string) => t.replace(/\.md$/i, '').toLowerCase();

test.describe('vault integrity on a 500-note vault (real app)', () => {
  test('rename, move, external edit and restart keep the index == a cold rescan, with no new dangling links', async ({ noted }) => {
    test.setTimeout(180_000);
    const { vault } = noted;
    for (const f of fs.readdirSync(vault)) fs.rmSync(path.join(vault, f), { recursive: true, force: true });
    generateVault(vault, { count: 500, seed: 3 });
    const baseline = new Set(danglingTargets(vault).map(norm));
    const app = await noted.relaunch();

    const snapshot = () => app.win.evaluate(async () => {
      const api = (window as unknown as { electronAPI: Api }).electronAPI;
      return (await api.getVaultIndexSnapshot(undefined)).notes;
    });
    const expectSameAsColdScan = async (label: string) => {
      const live = await snapshot();
      const cold = coldScan(vault);
      expect(Object.keys(live).sort(), `${label}: notes`).toEqual(Object.keys(cold).sort());
      for (const [name, c] of Object.entries(cold)) {
        expect(live[name].links, `${label}: links of ${name}`).toEqual(c.links);
        expect(live[name].tags, `${label}: tags of ${name}`).toEqual(c.tags);
      }
    };
    const expectNoNewDangling = (label: string) => {
      expect(danglingTargets(vault).filter(t => !baseline.has(norm(t))), `${label}: dangling`).toEqual([]);
    };

    await expectSameAsColdScan('startup');

    const rand = rng(5);
    const notes = listNotes(vault);

    // 15 renames and 10 moves, through the app's own IPC (links rewritten).
    for (let i = 0; i < 15; i++) {
      const from = notes[Math.floor(rand() * notes.length)];
      if (!fs.existsSync(path.join(vault, from))) continue;
      const folder = from.includes('/') ? from.split('/')[0] + '/' : '';
      const to = `${folder}Renamed ${i} & co.md`;
      const res = await app.win.evaluate(([a, b]) => (window as unknown as { electronAPI: Api }).electronAPI.renameNote(a, b, undefined, { updateLinks: true }), [from, to]);
      expect(res.success, res.error).toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      const from = listNotes(vault)[Math.floor(rand() * 400)];
      const to = ['Projects', 'Archive', 'Ideas'][i % 3];
      if (from.startsWith(`${to}/`)) continue;
      const res = await app.win.evaluate(([a, b]) => (window as unknown as { electronAPI: Api }).electronAPI.moveNote(a, b, undefined, { updateLinks: true }), [from, to]);
      expect(res.success, res.error).toBe(true);
    }
    expectNoNewDangling('after renames and moves');
    await expectSameAsColdScan('after renames and moves');

    // Edits made outside the app.
    const names = listNotes(vault);
    for (let i = 0; i < 10; i++) {
      const p = path.join(vault, names[i * 11]);
      fs.writeFileSync(p, `<h1>edited</h1><p>outside #external${i % 3} [[${names[i * 13].replace(/\.md$/, '').replace(/&/g, '&amp;')}]]</p>`);
      fs.utimesSync(p, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    }
    await expect.poll(async () => {
      const live = await snapshot();
      const cold = coldScan(vault);
      return Object.keys(cold).every(n => live[n] && JSON.stringify(live[n].tags) === JSON.stringify(cold[n].tags) && JSON.stringify(live[n].links) === JSON.stringify(cold[n].links));
    }, { timeout: 30_000 }).toBe(true);
    await expectSameAsColdScan('after external edits');

    // Restart: a new process builds its index from the files and must agree.
    const restarted = await app.relaunch();
    app.win = restarted.win;
    await expectSameAsColdScan('after restart');
    expectNoNewDangling('after restart');
  });
});
