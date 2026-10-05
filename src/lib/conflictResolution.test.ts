import { describe, it, expect } from 'vitest';
import {
  conflictKey, isTextConflict, emptyTextDecision, resultText, remainingCount, remainingFor,
  reconcileDecisions, buildResolutions, displayLine, type Decisions,
} from './conflictResolution';
import type { GitSyncConflict } from './gitSyncTypes';

const text = (p: Partial<GitSyncConflict> = {}): GitSyncConflict => ({
  path: 'one.md', kind: 'both-modified', binary: false,
  base: '<p>a</p><p>b</p><p>c</p>', ours: '<p>a</p><p>B-mine</p><p>c</p>', theirs: '<p>a</p><p>B-theirs</p><p>c</p>',
  oursSha: 'o'.repeat(40), theirsSha: 't'.repeat(40), ...p,
});
const bin = (p: Partial<GitSyncConflict> = {}): GitSyncConflict =>
  ({ path: 'img.png', kind: 'both-modified', binary: true, base: null, ours: null, theirs: null, oursSha: 'a'.repeat(40), theirsSha: 'b'.repeat(40), ...p });
const key = conflictKey;

describe('conflict classification', () => {
  it('text conflicts are decided per hunk; binary and delete-vs-edit per file', () => {
    expect(isTextConflict(text())).toBe(true);
    expect(isTextConflict(bin())).toBe(false);
    expect(isTextConflict(text({ kind: 'deleted-by-them', theirs: null, theirsSha: null }))).toBe(false);
    expect(isTextConflict(text({ kind: 'deleted-by-us', ours: null, oursSha: null }))).toBe(false);
  });

  it('both-added text (no base) is a text conflict', () => {
    expect(isTextConflict(text({ kind: 'both-added', base: null }))).toBe(true);
  });
});

describe('text decisions', () => {
  it('start empty with one slot per conflicting hunk, and give no result yet', () => {
    const c = text();
    const d = emptyTextDecision(c);
    expect(d.choices).toHaveLength(1);
    expect(resultText(c, d)).toBeNull();
    expect(remainingFor(c, d)).toBe(1);
  });

  it('produce the merged note once decided', () => {
    const c = text();
    const d = { ...emptyTextDecision(c), choices: ['theirs' as const] };
    expect(resultText(c, d)).toContain('<p>B-theirs</p>');
    expect(resultText(c, d)).not.toContain('B-mine');
    expect(remainingFor(c, d)).toBe(0);
  });

  it('"both" keeps the two versions in order', () => {
    const c = text();
    const r = resultText(c, { ...emptyTextDecision(c), choices: ['both'] })!;
    expect(r.indexOf('B-mine')).toBeGreaterThan(-1);
    expect(r.indexOf('B-mine')).toBeLessThan(r.indexOf('B-theirs'));
  });

  it('a hand-edited result overrides the hunks and settles everything', () => {
    const c = text();
    const d = { ...emptyTextDecision(c), manual: '<p>my own text</p>' };
    expect(resultText(c, d)).toBe('<p>my own text</p>');
    expect(remainingFor(c, d)).toBe(0);
  });

  it('keeps clean changes from the other side', () => {
    const c = text({ ours: '<p>a</p><p>B-mine</p><p>c</p><p>only mine</p>', theirs: '<p>a</p><p>B-theirs</p><p>c</p>' });
    const d = { ...emptyTextDecision(c), choices: ['theirs' as const] };
    expect(resultText(c, d)).toContain('only mine');
  });
});

describe('remaining count', () => {
  it('sums undecided hunks and undecided per-file choices', () => {
    const t = text(), b = bin();
    const none: Decisions = {};
    expect(remainingCount([t, b], none)).toBe(2);
    const half: Decisions = { [key(t)]: { ...emptyTextDecision(t), choices: ['ours'] } };
    expect(remainingCount([t, b], half)).toBe(1);
    const all: Decisions = { ...half, [key(b)]: { kind: 'side', choice: 'theirs' } };
    expect(remainingCount([t, b], all)).toBe(0);
  });
});

describe('reconcile', () => {
  it('drops decisions for conflicts that changed or disappeared, keeps the rest', () => {
    const t = text(), b = bin();
    const decisions: Decisions = { [key(t)]: { kind: 'text', choices: ['ours'], manual: null }, [key(b)]: { kind: 'side', choice: 'ours' } };
    const changed = text({ theirsSha: 'x'.repeat(40) }); // the remote moved on
    const out = reconcileDecisions([changed, b], decisions);
    expect(Object.keys(out)).toEqual([key(b)]);
  });
});

describe('buildResolutions', () => {
  it('is null while anything is undecided', () => {
    const t = text(), b = bin();
    expect(buildResolutions([t, b], {})).toBeNull();
    expect(buildResolutions([t, b], { [key(t)]: { ...emptyTextDecision(t), choices: ['ours'] } })).toBeNull();
  });

  it('echoes the blob ids the user reviewed, with content for text and a side for the rest', () => {
    const t = text(), b = bin();
    const out = buildResolutions([t, b], {
      [key(t)]: { ...emptyTextDecision(t), choices: ['ours'] },
      [key(b)]: { kind: 'side', choice: 'theirs' },
    })!;
    expect(out[0]).toMatchObject({ path: 'one.md', oursSha: t.oursSha, theirsSha: t.theirsSha, choice: 'content' });
    expect(out[0].content).toContain('B-mine');
    expect(out[1]).toEqual({ path: 'img.png', oursSha: b.oursSha, theirsSha: b.theirsSha, choice: 'theirs' });
  });

  it('uses a side decision for a delete-vs-edit conflict', () => {
    const c = text({ kind: 'deleted-by-them', theirs: null, theirsSha: null });
    expect(buildResolutions([c], { [key(c)]: { kind: 'side', choice: 'ours' } })![0]).toMatchObject({ choice: 'ours', theirsSha: null });
  });

  it('ignores a wrong-kind decision instead of guessing', () => {
    const t = text();
    expect(buildResolutions([t], { [key(t)]: { kind: 'side', choice: 'ours' } })).toBeNull();
  });
});

describe('displayLine', () => {
  it('shows text rather than markup', () => {
    expect(displayLine('<p>Hello <strong>world</strong> &amp; co</p>')).toBe('Hello world & co');
  });
  it('passes plain text through untouched', () => {
    expect(displayLine('plain line')).toBe('plain line');
  });
  it('falls back to the raw line when it is only markup', () => {
    expect(displayLine('</ul>')).toBe('</ul>');
  });
});
