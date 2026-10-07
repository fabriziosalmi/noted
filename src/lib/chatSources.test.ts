import { describe, it, expect } from 'vitest';
import { assemblePrompt, finishAnswer } from './chatSources';
import type { RagChunk } from '../../shared/search/embeddingTypes';

const chunk = (over: Partial<RagChunk> = {}): RagChunk => ({
  name: 'Plan.md', title: 'Plan', headingPath: ['Goals'], text: 'Ship in October.', ord: 0, score: 0.03, lexicalRank: 1, denseRank: null, coverage: 1, similarity: null, ...over,
});
const active = { name: 'Today.md', title: 'Today', text: 'My note text.' };

describe('assemblePrompt', () => {
  it('numbers the active note first and then the sections, and tells the model to cite them', () => {
    const p = assemblePrompt({ lang: 'en', active, chunks: [chunk(), chunk({ name: 'B.md', title: 'B', headingPath: ['X', 'Y'], text: 'Other.' })], vaultOnly: false });
    expect(p.sources.map(s => [s.n, s.name])).toEqual([[1, 'Today.md'], [2, 'Plan.md'], [3, 'B.md']]);
    expect(p.system).toContain('[1] Today\nMy note text.');
    expect(p.system).toContain('[2] Plan › Goals\nShip in October.');
    expect(p.system).toContain('[3] B › X › Y\nOther.');
    expect(p.system).toMatch(/square brackets/);
    expect(p.system).not.toMatch(/Answer only from the sources/);
    expect(p.refuse).toBe(false);
  });

  it('without sources there is nothing to cite, and the model is not told to', () => {
    const p = assemblePrompt({ lang: 'en', active: null, chunks: [], vaultOnly: false });
    expect(p.sources).toEqual([]);
    expect(p.system).not.toMatch(/square brackets|Sources/);
    expect(p.refuse).toBe(false);
  });

  it('an empty active note is not a source', () => {
    expect(assemblePrompt({ lang: 'en', active: { ...active, text: '  \n' }, chunks: [chunk()], vaultOnly: false }).sources.map(s => s.name)).toEqual(['Plan.md']);
  });

  it('vault only: tells the model to answer from the sources alone, and offers only sections that hold up', () => {
    const strong = chunk({ coverage: 0.75 });
    const byMeaning = chunk({ name: 'M.md', coverage: 0, similarity: 0.6 });
    const weak = chunk({ name: 'W.md', coverage: 0.1, similarity: 0.1 });
    const p = assemblePrompt({ lang: 'en', active: null, chunks: [strong, weak, byMeaning], vaultOnly: true });
    expect(p.sources.map(s => s.name)).toEqual(['Plan.md', 'M.md']);
    expect(p.system).toMatch(/Answer only from the sources/);
    expect(p.refuse).toBe(false);
  });

  it('vault only, nothing supports an answer, no active note: the model is not asked', () => {
    const p = assemblePrompt({ lang: 'en', active: null, chunks: [chunk({ coverage: 0, similarity: 0.05 }), chunk({ coverage: 0.2 })], vaultOnly: true });
    expect(p.refuse).toBe(true);
    expect(p.sources).toEqual([]);
  });

  it('vault only with an open note: the note is a source, so the model is asked (and told to answer from it alone)', () => {
    const p = assemblePrompt({ lang: 'en', active, chunks: [], vaultOnly: true });
    expect(p.refuse).toBe(false);
    expect(p.sources).toHaveLength(1);
    expect(p.system).toMatch(/Answer only from the sources/);
  });

  it('the instructions follow the language, English for the languages without a text of their own', () => {
    expect(assemblePrompt({ lang: 'it', active, chunks: [], vaultOnly: true }).system).toMatch(/Rispondi solo con le fonti[\s\S]*Fonti:/);
    expect(assemblePrompt({ lang: 'de', active, chunks: [], vaultOnly: false }).system).toMatch(/square brackets/);
  });
});

describe('finishAnswer', () => {
  const sources = assemblePrompt({ lang: 'en', active, chunks: [chunk(), chunk({ name: 'B.md', title: 'B' })], vaultOnly: false }).sources;

  it('gives the sources cited, in the order they were cited, and the answer without invented numbers', () => {
    const r = finishAnswer('Due in October [2]. My note says so too [1]. Also [9].', sources, false);
    expect(r.content).toBe('Due in October [2]. My note says so too [1]. Also.');
    expect(r.cited.map(s => s.name)).toEqual(['Plan.md', 'Today.md']);
    expect(r.uncited).toBe(false);
  });

  it('an answer that cites nothing is plain; in vault only mode it is marked as not backed by the notes', () => {
    expect(finishAnswer('I think so.', sources, false)).toEqual({ content: 'I think so.', cited: [], uncited: false });
    expect(finishAnswer('I think so.', sources, true)).toEqual({ content: 'I think so.', cited: [], uncited: true });
  });

  it('only invented numbers count as citing nothing', () => {
    expect(finishAnswer('Sure [8].', sources, true)).toMatchObject({ content: 'Sure.', cited: [], uncited: true });
  });

  it('with no sources there is nothing to be uncited against', () => {
    expect(finishAnswer('Anything.', [], true).uncited).toBe(false);
  });
});
