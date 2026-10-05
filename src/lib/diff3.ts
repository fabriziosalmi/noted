/**
 * Three-way line merge (diff3) for the git-sync conflict view.
 *
 * Given the common ancestor (`base`) and the two edited versions (`ours`,
 * `theirs`), split the result into chunks:
 *   - stable    lines all three agree on
 *   - merged    a region only one side changed (or both changed identically):
 *               resolved automatically
 *   - conflict  both sides changed the same region differently: the user decides
 *
 * Notes are stored as HTML, usually on ONE long line, which a line diff cannot
 * work with. `splitLines` therefore breaks HTML at block boundaries (view-only
 * whitespace between blocks), so a changed paragraph conflicts as a paragraph.
 */

export type MergeChunk =
  | { kind: 'stable'; lines: string[] }
  | { kind: 'merged'; lines: string[]; from: 'ours' | 'theirs' | 'both' }
  | { kind: 'conflict'; base: string[]; ours: string[]; theirs: string[] };

export type Choice = 'ours' | 'theirs' | 'both' | 'base';

const BLOCK_CLOSERS = /(<\/(?:p|h[1-6]|li|ul|ol|blockquote|pre|table|thead|tbody|tr|div)>)(?!\n)/gi;

/**
 * Lines of a note for diffing. HTML notes get a newline after each closing block
 * tag; plain/Markdown text is split as-is, so `joinLines(splitLines(x)) === x`
 * for anything that is not HTML.
 */
export function splitLines(text: string): string[] {
  const prepared = text.trimStart().startsWith('<') ? text.replace(BLOCK_CLOSERS, '$1\n') : text;
  return prepared.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}

// Above this many DP cells (after trimming the common prefix/suffix) the exact
// LCS is skipped and the whole middle is treated as one changed region: a coarse
// but never-wrong conflict instead of a frozen UI.
const MAX_LCS_CELLS = 4_000_000;

/** For each index of `a`, the index of its LCS partner in `b`, or -1. */
function matchLines(a: string[], b: string[]): Int32Array {
  const match = new Int32Array(a.length).fill(-1);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) { match[lo] = lo; lo++; }
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > lo && bEnd > lo && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--; bEnd--;
    match[aEnd] = bEnd;
  }
  const n = aEnd - lo;
  const m = bEnd - lo;
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) return match;

  // Standard LCS table over the differing middle.
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[lo + i] === b[lo + j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[lo + i] === b[lo + j]) { match[lo + i] = lo + j; i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return match;
}

const same = (x: string[], y: string[]) => x.length === y.length && x.every((l, i) => l === y[i]);

export function diff3(base: string[], ours: string[], theirs: string[]): MergeChunk[] {
  const mo = matchLines(base, ours);
  const mt = matchLines(base, theirs);

  const chunks: MergeChunk[] = [];
  const pushStable = (line: string) => {
    const last = chunks[chunks.length - 1];
    if (last?.kind === 'stable') last.lines.push(line);
    else chunks.push({ kind: 'stable', lines: [line] });
  };
  const pushRegion = (b: string[], o: string[], t: string[]) => {
    if (b.length === 0 && o.length === 0 && t.length === 0) return;
    if (same(o, b)) chunks.push({ kind: 'merged', lines: t, from: 'theirs' });
    else if (same(t, b)) chunks.push({ kind: 'merged', lines: o, from: 'ours' });
    else if (same(o, t)) chunks.push({ kind: 'merged', lines: o, from: 'both' });
    else chunks.push({ kind: 'conflict', base: b, ours: o, theirs: t });
  };

  // A "sync point" is a base line that survived, in order, in both versions.
  let bi = 0; // next base line not yet emitted
  let oi = 0;
  let ti = 0;
  for (let i = 0; i <= base.length; i++) {
    const atEnd = i === base.length;
    if (!atEnd && (mo[i] === -1 || mt[i] === -1)) continue;
    const oNext = atEnd ? ours.length : mo[i];
    const tNext = atEnd ? theirs.length : mt[i];
    pushRegion(base.slice(bi, i), ours.slice(oi, oNext), theirs.slice(ti, tNext));
    if (!atEnd) pushStable(base[i]);
    bi = i + 1;
    oi = oNext + 1;
    ti = tNext + 1;
  }
  return chunks;
}

export function conflictCount(chunks: MergeChunk[]): number {
  return chunks.reduce((n, c) => n + (c.kind === 'conflict' ? 1 : 0), 0);
}

/**
 * The merged text with each conflict resolved by `choices` (indexed by conflict
 * order). Returns null while any conflict is still undecided.
 */
export function resolveChunks(chunks: MergeChunk[], choices: (Choice | undefined)[]): string[] | null {
  const out: string[] = [];
  let k = 0;
  for (const c of chunks) {
    if (c.kind !== 'conflict') { out.push(...c.lines); continue; }
    const choice = choices[k++];
    if (!choice) return null;
    if (choice === 'ours') out.push(...c.ours);
    else if (choice === 'theirs') out.push(...c.theirs);
    else if (choice === 'base') out.push(...c.base);
    else out.push(...c.ours, ...c.theirs);
  }
  return out;
}
