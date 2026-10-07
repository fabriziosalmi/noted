import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// Vectors for the vault's sections (#75), through the real app: the main process cuts notes by heading and keeps the vectors
// on disk, the page embeds (here with a toy embedder) and asks for the sections that answer a question. An edit costs one
// section, and what was embedded survives a restart.
interface Model { provider: string; model: string }
interface Api {
  embeddingsPending: (m: Model, limit: number) => Promise<{ success: boolean; error?: string; data?: { items: { hash: string; text: string }[]; remaining: number; status: { chunks: number; embedded: number; dimension: number } } }>;
  embeddingsPut: (m: Model, e: { hash: string; vector: Float32Array }[]) => Promise<{ success: boolean; error?: string; mismatch?: boolean; data?: number }>;
  ragSearch: (q: string, v: Float32Array | null, k: number, m: Model) => Promise<{ success: boolean; data?: { mode: string; chunks: { name: string; title: string; headingPath: string[]; text: string; lexicalRank: number | null; denseRank: number | null }[] } }>;
}

const MODEL: Model = { provider: 'lmstudio', model: 'toy' };
const GARAGE = '# Garage\n\nIntro to the garage.\n\n## Car\n\nThe car needs an oil change before winter.\n\n## Tools\n\nWrench, jack, and a torque gauge.\n';

test('embeddings: sections are embedded once, found by meaning, an edit costs one section, and it all survives a restart', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Garage.md'), GARAGE);
  fs.mkdirSync(path.join(noted.vault, 'Pets'));
  fs.writeFileSync(path.join(noted.vault, 'Pets', 'Dogs.md'), '# Dogs\n\n## Training\n\nThe dog learns to sit and to stay.\n');
  let { win } = await noted.relaunch();

  // The toy embedder, in the page: words hashed into 64 dimensions, a few synonyms folded together.
  const install = () => win.evaluate(() => {
    const syn: Record<string, string> = { automobile: 'car', vehicle: 'car', puppy: 'dog', hound: 'dog' };
    (window as unknown as { toy: (t: string) => Float32Array }).toy = (text: string) => {
      const v = new Float32Array(64);
      for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2)) {
        let h = 7;
        for (const ch of syn[raw] ?? raw) h = (h * 31 + ch.charCodeAt(0)) % 100003;
        v[h % 64] += 1;
      }
      return v;
    };
  });
  const sync = () => win.evaluate(async (model) => {
    const api = (window as unknown as { electronAPI: Api; toy: (t: string) => Float32Array }).electronAPI;
    const toy = (window as unknown as { toy: (t: string) => Float32Array }).toy;
    let sent = 0;
    const texts: string[] = [];
    for (let i = 0; i < 50; i++) {
      const p = await api.embeddingsPending(model, 32);
      if (!p.success || !p.data || p.data.items.length === 0) return { sent, texts, status: p.data?.status ?? null, error: p.error };
      const put = await api.embeddingsPut(model, p.data.items.map(it => ({ hash: it.hash, vector: toy(it.text) })));
      if (!put.success) return { sent, texts, status: null, error: put.error };
      sent += p.data.items.length;
      texts.push(...p.data.items.map(it => it.text));
    }
    return { sent, texts, status: null, error: 'did not finish' };
  }, MODEL);
  const ask = (q: string, withVector: boolean) => win.evaluate(async ({ q, withVector, model }) => {
    const api = (window as unknown as { electronAPI: Api }).electronAPI;
    const toy = (window as unknown as { toy: (t: string) => Float32Array }).toy;
    const r = await api.ragSearch(q, withVector ? toy(q) : null, 5, model);
    return r.data;
  }, { q, withVector, model: MODEL });

  await install();

  // First run: every section once
  const first = await sync();
  expect(first.error).toBeUndefined();
  expect(first.sent).toBe(4);
  expect(first.texts.sort()).toEqual([
    'Dogs › Training\n\nThe dog learns to sit and to stay.',
    'Garage\n\nIntro to the garage.',
    'Garage › Car\n\nThe car needs an oil change before winter.',
    'Garage › Tools\n\nWrench, jack, and a torque gauge.',
  ].sort());
  expect(first.status).toMatchObject({ chunks: 4, embedded: 4, dimension: 64 });
  expect(fs.readdirSync(path.join(noted.vault, '.noted', 'embeddings')).filter(f => f.endsWith('.bin'))).toHaveLength(1);

  // Found by meaning where no word is shared, and by words when there are no vectors in the question
  const byMeaning = await ask('automobile maintenance', true);
  expect(byMeaning?.mode).toBe('hybrid');
  expect(byMeaning?.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Car'], lexicalRank: null, denseRank: 1 });
  const byWords = await ask('torque gauge', false);
  expect(byWords?.mode).toBe('lexical');
  expect(byWords?.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Tools'] });

  // Refused at the edge: a hash that is not one, a vector that is not numbers
  const bad = await win.evaluate(async (model) => {
    const api = (window as unknown as { electronAPI: Api }).electronAPI;
    return [
      await api.embeddingsPut(model, [{ hash: 'nope', vector: new Float32Array([1, 2]) }]),
      await api.embeddingsPut(model, [{ hash: 'a'.repeat(32), vector: new Float32Array([1, 2, 3]) }]),
    ];
  }, MODEL);
  expect(bad[0].success).toBe(false);
  expect(bad[1]).toMatchObject({ success: false, mismatch: true });

  // An edit made outside the app costs only the section it touched
  fs.writeFileSync(path.join(noted.vault, 'Garage.md'), GARAGE.replace('oil change', 'tyre rotation'));
  await expect.poll(async () => (await sync()).texts, { timeout: 15_000 }).toEqual(['Garage › Car\n\nThe car needs an tyre rotation before winter.']);
  expect((await sync()).sent).toBe(0);

  // And nothing is embedded again after a restart
  ({ win } = await noted.relaunch());
  await install();
  const again = await sync();
  expect(again.sent).toBe(0);
  expect(again.status).toMatchObject({ chunks: 4, embedded: 4 });
  expect((await ask('automobile maintenance', true))?.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Car'] });
});
