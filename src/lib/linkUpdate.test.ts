import { describe, it, expect } from 'vitest';
import { readLinkUpdateMode, foldRename, isNoopRename } from './linkUpdate';

describe('readLinkUpdateMode', () => {
  it('defaults to always and accepts the other two', () => {
    expect(readLinkUpdateMode(undefined)).toBe('always');
    expect(readLinkUpdateMode('whatever')).toBe('always');
    expect(readLinkUpdateMode('ask')).toBe('ask');
    expect(readLinkUpdateMode('never')).toBe('never');
    expect(readLinkUpdateMode('always')).toBe('always');
  });
});

describe('foldRename', () => {
  it('starts a chain when nothing is pending', () => {
    expect(foldRename(null, { from: 'A.md', to: 'B.md' })).toEqual({ pending: { from: 'A.md', to: 'B.md' }, flush: null });
  });

  it('extends a chain, so links are rewritten once from the original name to the final one', () => {
    let p = foldRename(null, { from: 'A.md', to: 'B.md' }).pending;
    p = foldRename(p, { from: 'B.md', to: 'Bo.md' }).pending;
    const last = foldRename(p, { from: 'Bo.md', to: 'Bob.md' });
    expect(last).toEqual({ pending: { from: 'A.md', to: 'Bob.md' }, flush: null });
  });

  it('flushes the pending rename first when a different note is renamed', () => {
    const r = foldRename({ from: 'A.md', to: 'B.md' }, { from: 'X.md', to: 'Y.md' });
    expect(r).toEqual({ pending: { from: 'X.md', to: 'Y.md' }, flush: { from: 'A.md', to: 'B.md' } });
  });
});

describe('isNoopRename', () => {
  it('is true when the chain ended where it began, ignoring case and extension', () => {
    expect(isNoopRename({ from: 'A.md', to: 'a.md' })).toBe(true);
    expect(isNoopRename({ from: 'A.md', to: 'B.md' })).toBe(false);
  });
});
