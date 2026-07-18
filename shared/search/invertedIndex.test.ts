import { describe, it, expect } from 'vitest';
import { InvertedIndex, tokenize } from './invertedIndex';

const mk = (id: string, title: string, text: string, mtimeMs = 0) => ({ id, title, text, mtimeMs });

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, keeps accents, drops short tokens', () => {
    expect(tokenize('Hello, World! Città a x')).toEqual(['hello', 'world', 'città']);
  });
  it('honours stopwords', () => {
    expect(tokenize('the cat the dog', { stopwords: new Set(['the']) })).toEqual(['cat', 'dog']);
  });
});

describe('InvertedIndex', () => {
  it('add / size / has / getDoc / remove', () => {
    const idx = new InvertedIndex();
    idx.add(mk('a.md', 'Alpha', 'hello world'));
    expect(idx.size).toBe(1);
    expect(idx.has('a.md')).toBe(true);
    expect(idx.getDoc('a.md')?.text).toBe('hello world');
    idx.remove('a.md');
    expect(idx.size).toBe(0);
    expect(idx.has('a.md')).toBe(false);
  });

  it('ranks a title match above a body-only match', () => {
    const idx = new InvertedIndex();
    idx.add(mk('body.md', 'Something', 'the minerva project notes'));
    idx.add(mk('title.md', 'Minerva', 'unrelated content here'));
    expect(idx.search('minerva')[0].id).toBe('title.md');
  });

  it('ranks higher term frequency above lower', () => {
    const idx = new InvertedIndex();
    idx.add(mk('lots.md', 'x', 'apple apple apple apple'));
    idx.add(mk('few.md', 'y', 'apple orange banana grape'));
    expect(idx.search('apple')[0].id).toBe('lots.md');
  });

  it('weights a rarer term more (idf) and adds the all-terms bonus', () => {
    const idx = new InvertedIndex();
    idx.add(mk('1.md', 'a', 'common word here'));
    idx.add(mk('2.md', 'b', 'common word there'));
    idx.add(mk('3.md', 'c', 'common rare word'));
    expect(idx.search('rare')[0].id).toBe('3.md');
    expect(idx.search('common rare')[0].id).toBe('3.md');
  });

  it('upserts on re-add', () => {
    const idx = new InvertedIndex();
    idx.add(mk('a.md', 'A', 'first content'));
    idx.add(mk('a.md', 'A', 'second replaced text'));
    expect(idx.size).toBe(1);
    expect(idx.search('first')).toEqual([]);
    expect(idx.search('replaced')[0].id).toBe('a.md');
  });

  it('rename moves a doc without reindexing its text', () => {
    const idx = new InvertedIndex();
    idx.add(mk('old.md', 'Old', 'shared body token'));
    idx.rename('old.md', 'new.md', 'New');
    expect(idx.has('old.md')).toBe(false);
    expect(idx.has('new.md')).toBe(true);
    expect(idx.search('body')[0].id).toBe('new.md');
  });

  it('tie-breaks equal scores by most-recent mtime', () => {
    const idx = new InvertedIndex();
    idx.add(mk('older.md', 'x', 'apple', 1000));
    idx.add(mk('newer.md', 'y', 'apple', 2000));
    expect(idx.search('apple')[0].id).toBe('newer.md');
  });

  it('respects the result limit', () => {
    const idx = new InvertedIndex();
    for (let i = 0; i < 30; i++) idx.add(mk(`n${i}.md`, 'x', 'apple', i));
    expect(idx.search('apple', { limit: 5 })).toHaveLength(5);
  });

  it('returns [] for an empty query, single-char query, or empty index', () => {
    const idx = new InvertedIndex();
    expect(idx.search('anything')).toEqual([]);
    idx.add(mk('a.md', 'A', 'text'));
    expect(idx.search('')).toEqual([]);
    expect(idx.search('x')).toEqual([]);
  });
});
