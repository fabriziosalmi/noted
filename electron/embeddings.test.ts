// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FullTextSearchReadModel } from './fulltext-index';
import { EmbeddingService, type ModelRef } from './embeddings';
import { DimensionMismatchError, storeFile } from './embedding-store';
import { tokenize } from '../shared/search/invertedIndex';

// The chunks, the vectors and the ranking on a real vault, with a toy embedder: words hashed into dimensions, a few synonyms
// folded together so that a question can match a section by meaning alone.
const SYNONYMS: Record<string, string> = { automobile: 'car', vehicle: 'car', cars: 'car', puppy: 'dog', hound: 'dog', dogs: 'dog' };
const DIM = 64;
const embed = (text: string): number[] => {
  const v = new Array<number>(DIM).fill(0);
  for (const raw of tokenize(text)) {
    const t = SYNONYMS[raw] ?? raw;
    let h = 7;
    for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 100003;
    v[h % DIM] += 1;
  }
  return v;
};

const MODEL: ModelRef = { provider: 'lmstudio', model: 'toy' };
const ok = () => undefined;
let dir: string;
let service: EmbeddingService;
const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
/** A fresh service over the same vault: what an app restart does. */
const restart = () => { service = new EmbeddingService(new FullTextSearchReadModel()); };
/** Embeds everything that is pending, as the app does in batches; returns how many chunks were sent. */
async function sync(batch = 4): Promise<number> {
  let sent = 0;
  for (let guard = 0; guard < 500; guard++) {
    const { items } = await service.pending(dir, MODEL, batch, ok);
    if (items.length === 0) return sent;
    service.put(dir, MODEL, items.map(i => ({ hash: i.hash, vector: embed(i.text) })));
    sent += items.length;
  }
  throw new Error('sync did not finish');
}
const search = (q: string, k = 5, opts?: { maxPerNote?: number }) => service.search(dir, MODEL, q, embed(q), k, ok, opts);

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-embsvc-')));
  restart();
  write('Garage.md', '# Garage\n\nIntro to the garage.\n\n## Car\n\nThe car needs an oil change before winter.\n\n## Tools\n\nWrench, jack, and a torque gauge.\n');
  write('Pets/Dogs.md', '# Dogs\n\n## Training\n\nThe dog learns to sit and to stay.\n\n## Food\n\nKibble twice a day.\n');
  write('Journal.md', '# Journal\n\nWent for a walk. Nothing else happened today.\n');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('pending and put', () => {
  it('offers every chunk once, with the text to embed (its place first), and nothing once all have vectors', async () => {
    const first = await service.pending(dir, MODEL, 50, ok);
    expect(first.remaining).toBe(first.items.length);
    expect(first.items.map(i => i.text).sort()).toEqual([
      'Dogs › Food\n\nKibble twice a day.',
      'Dogs › Training\n\nThe dog learns to sit and to stay.',
      'Garage\n\nIntro to the garage.',
      'Garage › Car\n\nThe car needs an oil change before winter.',
      'Garage › Tools\n\nWrench, jack, and a torque gauge.',
      'Journal\n\nWent for a walk. Nothing else happened today.',
    ].sort());
    expect(first.status).toMatchObject({ chunks: 6, embedded: 0, dimension: 0 });
    expect(await sync()).toBe(6);
    const done = await service.pending(dir, MODEL, 50, ok);
    expect(done.items).toEqual([]);
    expect(done.status).toMatchObject({ chunks: 6, embedded: 6, dimension: DIM });
  });

  it('a batch is as large as asked, and the rest is counted', async () => {
    const batch = await service.pending(dir, MODEL, 2, ok);
    expect(batch.items).toHaveLength(2);
    expect(batch.remaining).toBe(6);
  });

  it('vectors outlive a restart: nothing is embedded again', async () => {
    await sync();
    restart();
    expect((await service.pending(dir, MODEL, 50, ok)).items).toEqual([]);
    expect(await service.status(dir, MODEL, ok)).toMatchObject({ chunks: 6, embedded: 6 });
    expect(fs.existsSync(storeFile(dir, MODEL.provider, MODEL.model))).toBe(true);
  });

  it('an edit costs the chunk it touched, and no other', async () => {
    await sync();
    write('Garage.md', fs.readFileSync(path.join(dir, 'Garage.md'), 'utf8').replace('oil change', 'tyre rotation'));
    await new Promise(r => setTimeout(r, 15));
    fs.utimesSync(path.join(dir, 'Garage.md'), new Date(), new Date(Date.now() + 5000));
    service = new EmbeddingService(new FullTextSearchReadModel()); // the app's index follows a save; here a fresh one reads the vault
    const next = await service.pending(dir, MODEL, 50, ok);
    expect(next.items.map(i => i.text)).toEqual(['Garage › Car\n\nThe car needs an tyre rotation before winter.']);
    expect(next.status.embedded).toBe(5);
  });

  it('moving a note to another folder costs nothing, renaming it costs its chunks, deleting it costs nothing', async () => {
    await sync();
    fs.mkdirSync(path.join(dir, 'Archive'));
    fs.renameSync(path.join(dir, 'Journal.md'), path.join(dir, 'Archive', 'Journal.md'));
    restart();
    expect((await service.pending(dir, MODEL, 50, ok)).items).toEqual([]);

    fs.renameSync(path.join(dir, 'Archive', 'Journal.md'), path.join(dir, 'Archive', 'Diary.md'));
    restart();
    // the title is part of what is embedded, so a new title is new text; the "# Journal" heading no longer repeats it, so it shows
    expect((await service.pending(dir, MODEL, 50, ok)).items.map(i => i.text)).toEqual(['Diary › Journal\n\nWent for a walk. Nothing else happened today.']);

    fs.rmSync(path.join(dir, 'Pets'), { recursive: true });
    restart();
    await sync();
    expect((await service.status(dir, MODEL, ok)).chunks).toBe(4);
  });

  it('vectors of chunks that are gone are given back once the vault is caught up', async () => {
    for (let i = 0; i < 40; i++) write(`Many/n${i}.md`, `# n${i}\n\nUnique text number ${i} about subject${i}.\n`);
    await sync(50);
    const file = storeFile(dir, MODEL.provider, MODEL.model);
    const before = fs.statSync(file).size;
    fs.rmSync(path.join(dir, 'Many'), { recursive: true });
    restart();
    await service.pending(dir, MODEL, 50, ok); // caught up: compacts
    expect(fs.statSync(file).size).toBeLessThan(before / 3);
    expect(await service.status(dir, MODEL, ok)).toMatchObject({ chunks: 6, embedded: 6 });
  });

  it('a model of its own has its own vectors: another model starts from nothing, the first is untouched', async () => {
    await sync();
    const other: ModelRef = { provider: 'ollama', model: 'other' };
    expect((await service.pending(dir, other, 50, ok)).items).toHaveLength(6);
    expect((await service.pending(dir, MODEL, 50, ok)).items).toHaveLength(0);
  });

  it('refuses vectors of another size than the model has produced so far, and clear starts it over', async () => {
    await sync();
    expect(() => service.put(dir, MODEL, [{ hash: 'f'.repeat(32), vector: [1, 2, 3] }])).toThrow(DimensionMismatchError);
    service.clear(dir, MODEL);
    expect((await service.pending(dir, MODEL, 50, ok)).items).toHaveLength(6);
    expect(fs.existsSync(storeFile(dir, MODEL.provider, MODEL.model))).toBe(false);
  });

  it('concurrent requests agree and do not corrupt the table', async () => {
    const [a, b, c] = await Promise.all([service.pending(dir, MODEL, 50, ok), service.status(dir, MODEL, ok), service.pending(dir, MODEL, 2, ok)]);
    expect(a.items).toHaveLength(6);
    expect(b.chunks).toBe(6);
    expect(c.items).toHaveLength(2);
  });

  it('chunks the notes of a vault that is still HTML, and skips folders that are not notes', async () => {
    write('Old.md', '<h1>Old</h1><p>Intro.</p><h2>Part</h2><p>Body.</p>');
    write('.hidden/Secret.md', '# Secret\n\nno\n');
    const texts = (await service.pending(dir, MODEL, 50, ok)).items.map(i => i.text);
    expect(texts).toContain('Old › Part\n\nBody.');
    expect(texts.some(t => t.includes('Secret'))).toBe(false);
  });
});

describe('search', () => {
  beforeEach(async () => { await sync(); });

  it('finds a section by meaning when it shares no word with the question', async () => {
    const out = await search('automobile maintenance');
    expect(out.mode).toBe('hybrid');
    expect(out.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Car'], text: 'The car needs an oil change before winter.' });
    expect(out.chunks[0].lexicalRank).toBeNull(); // no word in common: the meaning found it alone
    expect(out.chunks[0].denseRank).toBe(1);
  });

  it('finds a section by words, and the one that both rankings like comes first', async () => {
    const out = await search('car oil change');
    expect(out.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Car'] });
    expect(out.chunks[0].lexicalRank).toBe(1);
    expect(out.chunks[0].denseRank).toBe(1);
    expect(out.chunks[0].score).toBeGreaterThan(out.chunks[1].score);
  });

  it('returns sections, not whole notes: the right heading of the right note', async () => {
    const out = await search('puppy training');
    expect(out.chunks[0]).toMatchObject({ name: 'Pets/Dogs.md', title: 'Dogs', headingPath: ['Training'], text: 'The dog learns to sit and to stay.' });
  });

  it('says why a section came back: how much of the question\'s words it holds, and how close it is in meaning', async () => {
    const both = (await search('car oil change')).chunks[0];
    expect(both).toMatchObject({ name: 'Garage.md', headingPath: ['Car'], coverage: 1 });
    expect(both.similarity).toBeGreaterThan(0.5);
    const meaningOnly = (await search('automobile maintenance')).chunks[0];
    expect(meaningOnly.coverage).toBe(0);
    expect(meaningOnly.similarity).toBeGreaterThan(0.3);
    // "the" and "of" do not count: a question that is all small words has no coverage to claim
    const small = await service.search(dir, MODEL, 'what is the', null, 5, ok);
    expect(small.chunks.every(c => c.coverage === 0)).toBe(true);
    // half of the significant words ("garage", "wrench" are in different sections: one each)
    const half = await service.search(dir, MODEL, 'wrench dolphin', null, 5, ok);
    expect(half.chunks[0]).toMatchObject({ headingPath: ['Tools'], coverage: 0.5, similarity: null });
  });

  it('with no question vector, or one of another size, it is the words alone', async () => {
    const none = await service.search(dir, MODEL, 'oil change', null, 5, ok);
    expect(none.mode).toBe('lexical');
    expect(none.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Car'], denseRank: null });
    const wrong = await service.search(dir, MODEL, 'oil change', [1, 2, 3], 5, ok);
    expect(wrong.mode).toBe('lexical');
    expect(wrong.chunks[0].name).toBe('Garage.md');
  });

  it('before anything is embedded it is the words alone, and still finds the section', async () => {
    service.clear(dir, MODEL);
    const out = await search('torque gauge');
    expect(out.mode).toBe('lexical');
    expect(out.chunks[0]).toMatchObject({ name: 'Garage.md', headingPath: ['Tools'] });
  });

  it('no more than maxPerNote sections of one note, and never more than asked for', async () => {
    write('Big.md', '# Big\n\n## A\n\ncar one\n\n## B\n\ncar two\n\n## C\n\ncar three\n\n## D\n\ncar four\n');
    restart(); // the app's index follows its own writes; a new service reads the vault again
    await sync();
    const capped = await search('car', 10, { maxPerNote: 2 });
    expect(capped.chunks.filter(c => c.name === 'Big.md')).toHaveLength(2);
    expect((await search('car', 3)).chunks).toHaveLength(3);
  });

  it('the word ranking looks into as many notes as it is told to', async () => {
    for (let i = 0; i < 12; i++) write(`Many/car${i}.md`, `# car${i}\n\ncar number ${i} is parked\n`);
    restart();
    await sync(50);
    const wide = await service.search(dir, MODEL, 'car parked', null, 50, ok, { maxPerNote: 1, pool: 100 });
    const narrow = await service.search(dir, MODEL, 'car parked', null, 50, ok, { maxPerNote: 1, pool: 5 });
    expect(wide.chunks.length).toBeGreaterThan(narrow.chunks.length);
    expect(narrow.chunks.length).toBeLessThanOrEqual(5);
  });

  it('a note that is deleted after it was indexed is not returned', async () => {
    fs.rmSync(path.join(dir, 'Garage.md'));
    const out = await search('oil change');
    expect(out.chunks.every(c => c.name !== 'Garage.md')).toBe(true);
  });

  it('says nothing for a question no section matches by words, and an empty vault gives nothing', async () => {
    expect((await service.search(dir, MODEL, 'zzzzqqq', null, 5, ok)).chunks).toEqual([]);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-embsvc-empty-'));
    try { expect((await service.search(empty, MODEL, 'anything', embed('anything'), 5, ok)).chunks).toEqual([]); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });
});
