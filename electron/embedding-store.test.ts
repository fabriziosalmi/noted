// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkHash, DimensionMismatchError, EmbeddingStore, storeFile } from './embedding-store';

let dir: string;
let file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-emb-')); file = storeFile(dir, 'lmstudio', 'nomic-embed'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const h = (s: string) => chunkHash(s);
const row = (store: EmbeddingStore, hash: string) => {
  const m = store.matrix();
  const i = m.ids.indexOf(hash);
  return Array.from(m.rows.subarray(i * m.dim, (i + 1) * m.dim));
};

describe('chunkHash and storeFile', () => {
  it('the hash is 32 hex characters, the same for the same text and not for another', () => {
    expect(h('a')).toMatch(/^[0-9a-f]{32}$/);
    expect(h('a')).toBe(h('a'));
    expect(h('a')).not.toBe(h('b'));
  });

  it('a model has its own file inside .noted/embeddings, and models that slug alike do not share one', () => {
    expect(path.dirname(file)).toBe(path.join(dir, '.noted', 'embeddings'));
    expect(path.basename(file)).toMatch(/^lmstudio-nomic-embed-[0-9a-f]{8}\.bin$/);
    expect(storeFile(dir, 'ollama', 'a/b')).not.toBe(storeFile(dir, 'ollama', 'a:b'));
    expect(storeFile(dir, 'ollama', '../../etc/passwd').startsWith(path.join(dir, '.noted', 'embeddings'))).toBe(true);
  });
});

describe('EmbeddingStore', () => {
  it('starts empty, stores vectors as unit length, and finds them again after reopening', () => {
    const store = EmbeddingStore.open(file);
    expect([store.size, store.dimension]).toEqual([0, 0]);
    expect(store.add([{ hash: h('x'), vector: [3, 4] }, { hash: h('y'), vector: [0, 2] }])).toBe(2);
    expect(row(store, h('x'))[0]).toBeCloseTo(0.6, 6);
    expect(row(store, h('x'))[1]).toBeCloseTo(0.8, 6);

    const again = EmbeddingStore.open(file);
    expect([again.size, again.dimension]).toEqual([2, 2]);
    expect(again.has(h('x'))).toBe(true);
    expect(row(again, h('y'))).toEqual([0, 1]);
    expect(again.has(h('z'))).toBe(false);
  });

  it('what is stored already is not stored again, even when offered twice in one go', () => {
    const store = EmbeddingStore.open(file);
    expect(store.add([{ hash: h('x'), vector: [1, 0] }, { hash: h('x'), vector: [0, 1] }])).toBe(1);
    expect(store.add([{ hash: h('x'), vector: [0, 1] }])).toBe(0);
    expect(row(store, h('x'))).toEqual([1, 0]);
    expect(fs.statSync(file).size).toBe(16 + 1 * (16 + 2 * 4));
  });

  it('refuses a vector of another size, before writing anything', () => {
    const store = EmbeddingStore.open(file);
    store.add([{ hash: h('x'), vector: [1, 0, 0] }]);
    const before = fs.statSync(file).size;
    expect(() => store.add([{ hash: h('y'), vector: [1, 0, 0] }, { hash: h('z'), vector: [1, 0] }])).toThrow(DimensionMismatchError);
    expect(fs.statSync(file).size).toBe(before);
    expect(store.size).toBe(1);
    expect(() => store.add([{ hash: h('e'), vector: [] }])).toThrow(/dimension|empty/);
  });

  it('grows past its first allocation without losing a vector', () => {
    const store = EmbeddingStore.open(file);
    for (let i = 0; i < 200; i += 20) store.add(Array.from({ length: 20 }, (_, j) => ({ hash: h(`c${i + j}`), vector: [i + j + 1, 1, 0] })));
    expect(store.size).toBe(200);
    const again = EmbeddingStore.open(file);
    expect(again.size).toBe(200);
    for (const n of [0, 77, 199]) expect(row(again, h(`c${n}`))).toEqual(row(store, h(`c${n}`)));
  });

  it('a torn last record (a crash while writing) is cut off, and the store carries on from the last whole one', () => {
    const store = EmbeddingStore.open(file);
    store.add([{ hash: h('a'), vector: [1, 0] }, { hash: h('b'), vector: [0, 1] }]);
    const whole = fs.statSync(file).size;
    fs.appendFileSync(file, Buffer.from('garbage-of-a-partial-record'.slice(0, 11)));
    const reopened = EmbeddingStore.open(file);
    expect(reopened.size).toBe(2);
    expect(fs.statSync(file).size).toBe(whole); // trimmed back, so the next append lines up
    reopened.add([{ hash: h('c'), vector: [1, 1] }]);
    expect(EmbeddingStore.open(file).size).toBe(3);
  });

  it('a file that is not a store, or has a header of a version it does not know, is an empty store (and is replaced on the first write)', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not an embeddings file at all, just some text of a decent length');
    expect(EmbeddingStore.open(file).size).toBe(0);
    const header = Buffer.alloc(16);
    header.write('NEMB', 0, 'latin1'); header.writeUInt32LE(99, 4); header.writeUInt32LE(2, 8);
    fs.writeFileSync(file, header);
    expect(EmbeddingStore.open(file).size).toBe(0);
    fs.writeFileSync(file, Buffer.alloc(3));
    expect(EmbeddingStore.open(file).size).toBe(0);
  });

  it('retain keeps the vectors of the chunks that still exist and gives the space of the rest back', () => {
    const store = EmbeddingStore.open(file);
    store.add(['a', 'b', 'c', 'd'].map((s, i) => ({ hash: h(s), vector: [i + 1, 1] })));
    const keptRow = row(store, h('c'));
    expect(store.retain(new Set([h('a'), h('c'), h('not stored')]))).toBe(2);
    expect(store.size).toBe(2);
    expect(store.has(h('b'))).toBe(false);
    expect(row(store, h('c'))).toEqual(keptRow);
    expect(fs.statSync(file).size).toBe(16 + 2 * (16 + 8));
    const again = EmbeddingStore.open(file);
    expect([again.size, again.has(h('a')), again.has(h('d'))]).toEqual([2, true, false]);
    expect(row(again, h('c'))).toEqual(keptRow);
    expect(store.retain(new Set([h('a'), h('c')]))).toBe(0); // nothing to drop: the file is not rewritten
    store.add([{ hash: h('e'), vector: [1, 1] }]); // and it still takes new ones
    expect(EmbeddingStore.open(file).size).toBe(3);
  });

  it('clear forgets everything and removes the file', () => {
    const store = EmbeddingStore.open(file);
    store.add([{ hash: h('a'), vector: [1, 0] }]);
    store.clear();
    expect(store.size).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    store.add([{ hash: h('b'), vector: [1, 0, 0] }]); // a model of another size can start again
    expect(EmbeddingStore.open(file).dimension).toBe(3);
  });

  it('matrix gives the ids and the rows in the same order', () => {
    const store = EmbeddingStore.open(file);
    store.add([{ hash: h('a'), vector: [1, 0] }, { hash: h('b'), vector: [0, 1] }]);
    const m = store.matrix();
    expect(m.ids).toEqual([h('a'), h('b')]);
    expect(Array.from(m.rows)).toEqual([1, 0, 0, 1]);
    expect(m.dim).toBe(2);
  });
});
