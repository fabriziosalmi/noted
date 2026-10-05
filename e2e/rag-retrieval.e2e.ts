import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// The AI chat's candidates come from the main process's index of the WHOLE vault:
// an old note must be found among hundreds of newer ones, and an external edit is
// searchable without a rescan.

test.describe('AI chat retrieval', () => {
  test('finds an old note among many newer ones, and follows an edit made outside the app', async ({ noted }) => {
    const { vault } = noted;
    for (let i = 0; i < 250; i++) {
      const p = path.join(vault, `standup-${i}.md`);
      fs.writeFileSync(p, `<p>weekly standup agenda item ${i}</p>`);
      fs.utimesSync(p, new Date(2026, 5, 1, 0, 0, i), new Date(2026, 5, 1, 0, 0, i));
    }
    const old = path.join(vault, 'Quokka plan.md');
    fs.writeFileSync(old, '<h1>Quokka plan</h1><p>The quokka migration budget is approved.</p>');
    fs.utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const again = await noted.relaunch();

    const ask = (q: string) => again.win.evaluate(async (query) => {
      const api = (window as unknown as { electronAPI: { ragCandidates: (q: string, n: number, d?: string) => Promise<{ data?: { candidates: { name: string }[] } }> } }).electronAPI;
      const r = await api.ragCandidates(query, 30, undefined);
      return r.data?.candidates.map((c: { name: string }) => c.name) ?? [];
    }, q);

    expect((await ask('quokka migration budget'))[0]).toBe('Quokka plan.md');

    fs.writeFileSync(path.join(vault, 'Platypus.md'), '<p>The platypus hearing is on Thursday.</p>');
    await expect.poll(() => ask('platypus hearing Thursday'), { timeout: 15_000 }).toContain('Platypus.md');
    fs.unlinkSync(path.join(vault, 'Platypus.md'));
    await expect.poll(() => ask('platypus hearing Thursday'), { timeout: 15_000 }).not.toContain('Platypus.md');
  });
});
