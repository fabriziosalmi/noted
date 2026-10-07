/**
 * A change to a text as a list of choices: each run of changed lines is one change that can be kept or dropped on its own, and
 * the text for any choice is composed from the pieces. This is what lets a person take part of what a model or an agent
 * proposed. Built on `diffText` (lines, with the changed words marked inside a rewritten line). Pure.
 */
import { diffText, type DiffRow } from './textDiff';

/** A run of lines that are the same on both sides, or one change (by id). */
export type Piece = { kind: 'same'; rows: DiffRow[] } | { kind: 'change'; id: number };

export interface Change {
  id: number;
  /** The lines of the text before, which the change replaces (none when it only adds). */
  removed: DiffRow[];
  /** The lines of the text after (none when it only deletes). */
  added: DiffRow[];
}

export interface Reviewable {
  pieces: Piece[];
  changes: Change[];
}

const lineOf = (row: DiffRow): string => row.segments.map(s => s.text).join('');

export function reviewable(before: string, after: string): Reviewable {
  const pieces: Piece[] = [];
  const changes: Change[] = [];
  let current: Change | null = null;
  let same: Extract<Piece, { kind: 'same' }> | null = null;
  for (const row of diffText(before, after)) {
    if (row.kind === 'same') {
      current = null;
      if (!same) { same = { kind: 'same', rows: [] }; pieces.push(same); }
      same.rows.push(row);
      continue;
    }
    same = null;
    if (!current) {
      current = { id: changes.length, removed: [], added: [] };
      changes.push(current);
      pieces.push({ kind: 'change', id: current.id });
    }
    (row.kind === 'del' ? current.removed : current.added).push(row);
  }
  return { pieces, changes };
}

/**
 * The text with the changes in `accepted` made and the others left as they were. Taking every change gives `after` and taking
 * none gives `before`, byte for byte (those two are returned as they are: lines are compared without their line ends, so a text
 * that differs only in its last newline or in CRLF is the same text to the diff). A mixture keeps the line ends of `before`.
 * With no change to choose, the result is `after`.
 */
export function compose(before: string, after: string, r: Reviewable, accepted: ReadonlySet<number>): string {
  if (r.changes.length === 0) return after; // nothing to choose between (the texts differ, if at all, only in line ends): the proposal
  const chosen = r.changes.filter(c => accepted.has(c.id)).length;
  if (chosen === 0) return before;
  if (chosen === r.changes.length) return after;
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const lines: string[] = [];
  for (const piece of r.pieces) {
    if (piece.kind === 'same') { for (const row of piece.rows) lines.push(lineOf(row)); continue; }
    const change = r.changes[piece.id];
    for (const row of accepted.has(piece.id) ? change.added : change.removed) lines.push(lineOf(row));
  }
  return lines.join(eol) + (after.endsWith('\n') ? eol : '');
}

/** The text of a row, as written. */
export const rowText = lineOf;
