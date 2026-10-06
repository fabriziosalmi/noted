/**
 * Text diffs a person can read (#64): changed lines, and inside a changed line the words that changed. Pure and
 * dependency-free, so the Git panel, the note history and the tests share one answer.
 *
 * Lines are compared exactly; a changed paragraph (one long line in Markdown) is then compared word by word.
 * The longest-common-subsequence table is only built for what is left after trimming the common start and end,
 * and a change too big for it is shown as "all removed, all added", which is always correct if less fine.
 */

export type DiffKind = 'same' | 'del' | 'add';

export interface DiffSegment {
  text: string;
  /** True for the words that differ from the other side of a changed line. */
  changed: boolean;
}

export interface DiffRow {
  kind: DiffKind;
  segments: DiffSegment[];
  /** 1-based line numbers in the old and new text (absent on the side that does not have the line). */
  oldLine?: number;
  newLine?: number;
}

interface Op<T> {
  type: 'equal' | 'del' | 'add';
  items: T[];
}

const MAX_CELLS = 4_000_000;

/** The edit script turning `a` into `b`, as runs of equal / deleted / added items. */
export function diffSequences<T>(a: readonly T[], b: readonly T[]): Op<T>[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops: Op<T>[] = [];
  const push = (type: Op<T>['type'], item: T) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.items.push(item);
    else ops.push({ type, items: [item] });
  };

  for (let i = 0; i < start; i++) push('equal', a[i]);

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    // lcs[i][j]: length of the longest common subsequence of a[start+i..] and b[start+j..]
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] = a[start + i] === b[start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) { push('equal', a[start + i]); i++; j++; }
      else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) { push('del', a[start + i]); i++; }
      else { push('add', b[start + j]); j++; }
    }
    while (i < n) push('del', a[start + i++]);
    while (j < m) push('add', b[start + j++]);
  } else {
    for (let i = start; i < endA; i++) push('del', a[i]);
    for (let j = start; j < endB; j++) push('add', b[j]);
  }

  for (let i = endA; i < a.length; i++) push('equal', a[i]);
  return ops;
}

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu;
const tokens = (s: string): string[] => s.match(TOKEN) ?? [];

/** Merge neighbouring tokens that share a flag into segments. */
function toSegments(parts: { text: string; changed: boolean }[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.changed === p.changed) last.text += p.text;
    else out.push({ text: p.text, changed: p.changed });
  }
  return out;
}

/** The two sides of one changed line, with the differing words flagged. */
export function diffWords(before: string, after: string): { before: DiffSegment[]; after: DiffSegment[] } {
  const oldParts: { text: string; changed: boolean }[] = [];
  const newParts: { text: string; changed: boolean }[] = [];
  for (const op of diffSequences(tokens(before), tokens(after))) {
    for (const t of op.items) {
      if (op.type !== 'add') oldParts.push({ text: t, changed: op.type === 'del' });
      if (op.type !== 'del') newParts.push({ text: t, changed: op.type === 'add' });
    }
  }
  return { before: toSegments(oldParts), after: toSegments(newParts) };
}

/** A text as lines; a trailing newline does not make an extra empty line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const plain = (text: string): DiffSegment[] => (text === '' ? [] : [{ text, changed: false }]);

/** Rows of a unified diff: unchanged lines, removed lines, added lines, the latter two with word-level flags where a line replaces a line. */
export function diffText(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  const ops = diffSequences(splitLines(before), splitLines(after));
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === 'equal') {
      for (const text of op.items) rows.push({ kind: 'same', segments: plain(text), oldLine: oldLine++, newLine: newLine++ });
      continue;
    }
    // a deleted run followed by an added run is a rewrite: pair them line by line
    const next = ops[k + 1];
    const removed = op.type === 'del' ? op.items : [];
    const added = op.type === 'add' ? op.items : next?.type === 'add' && op.type === 'del' ? next.items : [];
    if (op.type === 'del' && next?.type === 'add') k++;
    const pairs = Math.min(removed.length, added.length);
    const oldSide: DiffRow[] = [];
    const newSide: DiffRow[] = [];
    removed.forEach((text, i) => {
      const segments = i < pairs ? diffWords(text, added[i]).before : plain(text);
      oldSide.push({ kind: 'del', segments, oldLine: oldLine++ });
    });
    added.forEach((text, i) => {
      const segments = i < pairs ? diffWords(removed[i], text).after : plain(text);
      newSide.push({ kind: 'add', segments, newLine: newLine++ });
    });
    rows.push(...oldSide, ...newSide);
  }
  return rows;
}

export interface DiffHunk {
  rows: DiffRow[];
  /** Unchanged lines left out between the previous hunk (or the start) and this one. */
  skipped: number;
}

/** Only the changes and `context` unchanged lines around them. */
export function toHunks(rows: readonly DiffRow[], context = 2): { hunks: DiffHunk[]; skippedAfter: number } {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
  });
  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffHunk | null = null;
  rows.forEach((row, i) => {
    if (!keep[i]) {
      skipped++;
      current = null;
      return;
    }
    if (!current) {
      current = { rows: [], skipped };
      hunks.push(current);
      skipped = 0;
    }
    current.rows.push(row);
  });
  return { hunks, skippedAfter: skipped };
}

export function diffStats(rows: readonly DiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter(r => r.kind === 'add').length,
    removed: rows.filter(r => r.kind === 'del').length,
  };
}
