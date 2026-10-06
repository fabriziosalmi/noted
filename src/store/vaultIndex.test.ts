import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import type { VaultIndexSnapshot, VaultIndexDelta } from '../lib/vaultIndexTypes';

const snap = (seq: number, notes: VaultIndexSnapshot['notes'], vault = '/v'): VaultIndexSnapshot => ({ vault, seq, notes });
const delta = (seq: number, upserts: VaultIndexDelta['upserts'], removals: string[] = [], vault = '/v'): VaultIndexDelta => ({ vault, seq, upserts, removals });
const s = () => useStore.getState();

beforeEach(() => {
  useStore.setState({ noteLinksIndex: {}, tagIndex: {}, vaultIndexSync: null });
});

describe('vault index in the store', () => {
  it('a snapshot fills both maps, replacing whatever was there', () => {
    useStore.setState({ noteLinksIndex: { 'old.md': ['x'] }, tagIndex: { '#old': ['old.md'] } });
    s().applyVaultIndexSnapshot(snap(3, {
      'A.md': { links: ['B'], tags: ['#idea', '#x'] },
      'B.md': { links: [], tags: ['#idea'] },
    }));
    expect(s().noteLinksIndex).toEqual({ 'A.md': ['B'], 'B.md': [] });
    expect(s().tagIndex).toEqual({ '#idea': ['A.md', 'B.md'], '#x': ['A.md'] });
    expect(s().vaultIndexSync).toEqual({ vault: '/v', seq: 3 });
  });

  it('a delta replaces a note\'s links and moves it between tags', () => {
    s().applyVaultIndexSnapshot(snap(1, { 'A.md': { links: ['B'], tags: ['#a'] }, 'B.md': { links: [], tags: ['#a'] } }));
    s().applyVaultIndexDelta(delta(2, { 'A.md': { links: ['C'], tags: ['#b'] } }));
    expect(s().noteLinksIndex['A.md']).toEqual(['C']);
    expect(s().tagIndex).toEqual({ '#a': ['B.md'], '#b': ['A.md'] });
    expect(s().vaultIndexSync!.seq).toBe(2);
  });

  it('a delta removes notes and prunes tags that become empty', () => {
    s().applyVaultIndexSnapshot(snap(1, { 'A.md': { links: [], tags: ['#only'] }, 'B.md': { links: [], tags: [] } }));
    s().applyVaultIndexDelta(delta(2, {}, ['A.md']));
    expect(s().noteLinksIndex).toEqual({ 'B.md': [] });
    expect(s().tagIndex).toEqual({});
  });

  it('a rename arrives as removal + upsert and leaves one entry', () => {
    s().applyVaultIndexSnapshot(snap(1, { 'Old.md': { links: ['X'], tags: ['#t'] } }));
    s().applyVaultIndexDelta(delta(2, { 'New.md': { links: ['X'], tags: ['#t'] } }, ['Old.md']));
    expect(s().noteLinksIndex).toEqual({ 'New.md': ['X'] });
    expect(s().tagIndex).toEqual({ '#t': ['New.md'] });
  });

  it('drops a delta the snapshot already includes (seq not newer), applying later ones in order', () => {
    s().applyVaultIndexSnapshot(snap(5, { 'A.md': { links: [], tags: ['#new'] } }));
    s().applyVaultIndexDelta(delta(4, { 'A.md': { links: [], tags: ['#older'] } }));
    s().applyVaultIndexDelta(delta(5, { 'A.md': { links: [], tags: ['#same-seq'] } }));
    expect(s().tagIndex).toEqual({ '#new': ['A.md'] });
    s().applyVaultIndexDelta(delta(6, { 'A.md': { links: [], tags: ['#latest'] } }));
    expect(s().tagIndex).toEqual({ '#latest': ['A.md'] });
  });

  it('ignores deltas for another vault, and deltas before any snapshot', () => {
    s().applyVaultIndexDelta(delta(1, { 'A.md': { links: [], tags: ['#x'] } }));
    expect(s().tagIndex).toEqual({});
    s().applyVaultIndexSnapshot(snap(1, {}, '/v'));
    s().applyVaultIndexDelta(delta(9, { 'A.md': { links: [], tags: ['#x'] } }, [], '/other'));
    expect(s().tagIndex).toEqual({});
  });

  it('switching vaults: a new snapshot replaces the old vault entirely', () => {
    s().applyVaultIndexSnapshot(snap(1, { 'A.md': { links: [], tags: ['#a'] } }, '/v1'));
    s().applyVaultIndexSnapshot(snap(1, { 'Z.md': { links: [], tags: ['#z'] } }, '/v2'));
    expect(s().noteLinksIndex).toEqual({ 'Z.md': [] });
    s().applyVaultIndexDelta(delta(2, { 'A.md': { links: [], tags: ['#a'] } }, [], '/v1')); // stale vault
    expect(s().noteLinksIndex).toEqual({ 'Z.md': [] });
  });
});

describe('aliases in the store', () => {
  beforeEach(() => useStore.setState({ noteAliasesIndex: {} }));

  it('keeps the aliases of the notes that have any, from a snapshot and through deltas', () => {
    s().applyVaultIndexSnapshot(snap(1, {
      'A.md': { links: [], tags: [], aliases: ['Start'] },
      'B.md': { links: [], tags: [], aliases: [] },
    }));
    expect(s().noteAliasesIndex).toEqual({ 'A.md': ['Start'] });
    s().applyVaultIndexDelta(delta(2, { 'B.md': { links: [], tags: [], aliases: ['Beta'] }, 'A.md': { links: [], tags: [], aliases: [] } }));
    expect(s().noteAliasesIndex).toEqual({ 'B.md': ['Beta'] });
    s().applyVaultIndexDelta(delta(3, {}, ['B.md']));
    expect(s().noteAliasesIndex).toEqual({});
  });
});


describe('frontmatter fields in the store', () => {
  beforeEach(() => useStore.setState({ frontmatterIndex: {} }));

  it('keeps the fields of the notes that have any, from a snapshot and through deltas', () => {
    s().applyVaultIndexSnapshot(snap(1, {
      'A.md': { links: [], tags: [], aliases: [], fields: { status: 'open', votes: 2 } },
      'B.md': { links: [], tags: [], aliases: [], fields: {} },
    }));
    expect(s().frontmatterIndex).toEqual({ 'A.md': { status: 'open', votes: 2 } });
    s().applyVaultIndexDelta(delta(2, {
      'A.md': { links: [], tags: [], aliases: [], fields: { status: 'done', votes: 2 } },
      'B.md': { links: [], tags: [], aliases: [], fields: { tags: ['x'] } },
    }));
    expect(s().frontmatterIndex).toEqual({ 'A.md': { status: 'done', votes: 2 }, 'B.md': { tags: ['x'] } });
    s().applyVaultIndexDelta(delta(3, { 'A.md': { links: [], tags: [], aliases: [], fields: {} } }, ['B.md']));
    expect(s().frontmatterIndex).toEqual({});
  });
});
