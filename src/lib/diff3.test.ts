// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { diff3, resolveChunks, conflictCount, splitLines, joinLines, type MergeChunk } from './diff3';

const L = (s: string) => (s === '' ? [] : s.split(' '));

/** Merge with every conflict decided the same way; null if it still conflicts and no choice is given. */
function mergeText(base: string[], ours: string[], theirs: string[]): { clean: boolean; lines: string[] | null; chunks: MergeChunk[] } {
  const chunks = diff3(base, ours, theirs);
  const n = conflictCount(chunks);
  return { clean: n === 0, lines: n === 0 ? resolveChunks(chunks, []) : null, chunks };
}

describe('splitLines / joinLines', () => {
  it('round-trips plain text exactly, including the trailing newline', () => {
    for (const t of ['', 'a', 'a\nb', 'a\nb\n', '\n\n', 'x\r\ny']) expect(joinLines(splitLines(t))).toBe(t);
  });

  it('breaks HTML into one line per block, so paragraphs can conflict independently', () => {
    expect(splitLines('<h1>T</h1><p>one</p><ul><li>a</li><li>b</li></ul>')).toEqual([
      '<h1>T</h1>', '<p>one</p>', '<ul><li>a</li>', '<li>b</li>', '</ul>', '',
    ]);
  });

  it('is idempotent on HTML that is already split', () => {
    const once = joinLines(splitLines('<p>a</p><p>b</p>'));
    expect(joinLines(splitLines(once))).toBe(once);
  });

  it('leaves the document the same once re-joined, ignoring the inserted block newlines', () => {
    const html = '<h1>T</h1><p>one</p><p>two</p>';
    expect(joinLines(splitLines(html)).replace(/\n/g, '')).toBe(html);
  });
});

describe('diff3 basics', () => {
  it('identical sides are clean and equal to that side', () => {
    const r = mergeText(L('a b c'), L('a X c'), L('a X c'));
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(L('a X c'));
    expect(r.chunks.some(c => c.kind === 'merged' && c.from === 'both')).toBe(true);
  });

  it('takes the side that changed when the other is untouched', () => {
    expect(mergeText(L('a b c'), L('a b c'), L('a Y c')).lines).toEqual(L('a Y c'));
    expect(mergeText(L('a b c'), L('a X c'), L('a b c')).lines).toEqual(L('a X c'));
  });

  it('merges edits in different places', () => {
    expect(mergeText(L('a b c d e'), L('a X c d e'), L('a b c d Z')).lines).toEqual(L('a X c d Z'));
  });

  it('reports a conflict when both sides change the same line differently', () => {
    const r = mergeText(L('a b c'), L('a X c'), L('a Y c'));
    expect(r.clean).toBe(false);
    const c = r.chunks.find(x => x.kind === 'conflict');
    expect(c).toEqual({ kind: 'conflict', base: ['b'], ours: ['X'], theirs: ['Y'] });
  });

  it('delete vs edit of the same line conflicts', () => {
    const r = mergeText(L('a b c'), L('a c'), L('a Y c'));
    expect(r.clean).toBe(false);
    expect(r.chunks.find(x => x.kind === 'conflict')).toEqual({ kind: 'conflict', base: ['b'], ours: [], theirs: ['Y'] });
  });

  it('adjacent edits (no stable line between) conflict, separated ones do not', () => {
    expect(mergeText(L('a b c d'), L('a X c d'), L('a b Y d')).clean).toBe(false);
    expect(mergeText(L('a b c d e'), L('a X c d e'), L('a b c Y e')).clean).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(mergeText([], [], []).lines).toEqual([]);
    expect(mergeText([], L('a'), []).lines).toEqual(L('a'));
    expect(mergeText([], L('a'), L('b')).clean).toBe(false); // both added different content
  });

  it('keeps conflicts in document order and resolves them per choice', () => {
    const r = mergeText(L('a b c d e'), L('a X c Q e'), L('a Y c R e'));
    expect(conflictCount(r.chunks)).toBe(2);
    expect(resolveChunks(r.chunks, ['ours', 'theirs'])).toEqual(L('a X c R e'));
    expect(resolveChunks(r.chunks, ['theirs', 'ours'])).toEqual(L('a Y c Q e'));
    expect(resolveChunks(r.chunks, ['both', 'base'])).toEqual(L('a X Y c d e'));
    expect(resolveChunks(r.chunks, ['ours'])).toBeNull(); // second conflict undecided
    expect(resolveChunks(r.chunks, [])).toBeNull();
  });

  it('resolving every conflict with "ours" yields ours plus the other side\'s clean changes', () => {
    const r = mergeText(L('a b c d e'), L('a X c d e'), L('a Y c d Z'));
    expect(resolveChunks(r.chunks, ['ours'])).toEqual(L('a X c d Z'));
  });

  it('degrades to one coarse conflict instead of hanging on huge divergent inputs', () => {
    const big = (p: string) => Array.from({ length: 4000 }, (_, i) => `${p}${i}`);
    const t0 = Date.now();
    const chunks = diff3(big('b'), big('o'), big('t'));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(conflictCount(chunks)).toBeGreaterThanOrEqual(1);
  });
});

// ── Differential test against git's own three-way merge ───────────────────────

// Small deterministic PRNG so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random replace / delete / insert edits over UNIQUE lines (so the alignment is unambiguous). */
function edit(lines: string[], rand: () => number, tag: string): string[] {
  const out = [...lines];
  const edits = 1 + Math.floor(rand() * 3);
  for (let e = 0; e < edits; e++) {
    const pos = Math.floor(rand() * (out.length + 1));
    const kind = rand();
    if (kind < 0.4 && pos < out.length) out[pos] = `${tag}-edit-${e}-${pos}`;
    else if (kind < 0.7 && pos < out.length) out.splice(pos, 1);
    else out.splice(pos, 0, `${tag}-new-${e}-${pos}`);
  }
  return out;
}

let tmp: string;
function gitMergeFile(base: string[], ours: string[], theirs: string[]): { conflicts: number; text: string } {
  const f = (name: string, l: string[]) => { const p = path.join(tmp, name); fs.writeFileSync(p, l.map(x => x + '\n').join('')); return p; };
  const r = spawnSync('git', ['merge-file', '-p', f('ours', ours), f('base', base), f('theirs', theirs)], { encoding: 'utf8' });
  return { conflicts: r.status ?? -1, text: r.stdout };
}

describe('diff3 vs git merge-file', () => {
  it('agrees on conflict / no conflict and on the merged text, across random edits', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff3-'));
    try {
      execFileSync('git', ['--version']);
      let clean = 0;
      let conflicting = 0;
      const rand = rng(20261005);
      for (let iter = 0; iter < 300; iter++) {
        const n = 4 + Math.floor(rand() * 20);
        const base = Array.from({ length: n }, (_, i) => `line-${i}`);
        const ours = edit(base, rand, 'o');
        const theirs = edit(base, rand, 't');
        const mine = mergeText(base, ours, theirs);
        const git = gitMergeFile(base, ours, theirs);
        const ctx = () => `iter ${iter}\nbase:   ${base.join(',')}\nours:   ${ours.join(',')}\ntheirs: ${theirs.join(',')}\ngit:    ${JSON.stringify(git)}\nmine:   ${JSON.stringify(mine.chunks)}`;
        expect(mine.clean, ctx()).toBe(git.conflicts === 0);
        if (mine.clean) {
          clean++;
          expect(mine.lines!.map(x => x + '\n').join(''), ctx()).toBe(git.text);
        } else {
          conflicting++;
        }
      }
      // The generator must exercise both outcomes, or the comparison proves little.
      expect(clean).toBeGreaterThan(40);
      expect(conflicting).toBeGreaterThan(40);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000); // 300 git processes; slow when the whole suite runs in parallel
});
