/**
 * The state machine behind the sync-conflict view, free of React: what the user
 * has decided per conflicting note, how many decisions remain, and the exact
 * payload to hand to the sync engine. Text notes are decided per hunk (diff3);
 * everything else (binary, oversized, delete-vs-edit) is decided per file.
 */

import { diff3, splitLines, joinLines, conflictCount, resolveChunks, type Choice, type MergeChunk } from './diff3';
import type { GitSyncConflict, GitConflictResolution } from './gitSyncTypes';

export interface TextDecision {
  kind: 'text';
  /** One entry per conflicting hunk, in document order. */
  choices: (Choice | undefined)[];
  /** Hand-edited final text; when set it replaces the hunk choices entirely. */
  manual: string | null;
}
export interface SideDecision {
  kind: 'side';
  choice: 'ours' | 'theirs';
}
export type Decision = TextDecision | SideDecision;
export type Decisions = Record<string, Decision | undefined>;

/**
 * Identity of a conflict as the user saw it. If the remote changes again the blob
 * ids change, and any decision made for the old version no longer applies.
 */
export const conflictKey = (c: GitSyncConflict): string => `${c.path}\0${c.oursSha ?? ''}\0${c.theirsSha ?? ''}`;

/** Can this conflict be decided hunk by hunk? */
export function isTextConflict(c: GitSyncConflict): boolean {
  return !c.binary && c.ours !== null && c.theirs !== null;
}

export function chunksFor(c: GitSyncConflict): MergeChunk[] {
  return diff3(c.base === null ? [] : splitLines(c.base), splitLines(c.ours ?? ''), splitLines(c.theirs ?? ''));
}

export function emptyTextDecision(c: GitSyncConflict): TextDecision {
  return { kind: 'text', choices: new Array<Choice | undefined>(conflictCount(chunksFor(c))).fill(undefined), manual: null };
}

/** The merged text for a text conflict, or null while hunks are undecided. */
export function resultText(c: GitSyncConflict, d: TextDecision): string | null {
  if (d.manual !== null) return d.manual;
  const lines = resolveChunks(chunksFor(c), d.choices);
  return lines === null ? null : joinLines(lines);
}

/** Decisions still owed for one conflict (hunks for text, 1 for a per-file choice). */
export function remainingFor(c: GitSyncConflict, d: Decision | undefined): number {
  if (isTextConflict(c)) {
    const total = conflictCount(chunksFor(c));
    if (!d || d.kind !== 'text') return total;
    return d.manual !== null ? 0 : d.choices.slice(0, total).filter(x => x === undefined).length + Math.max(0, total - d.choices.length);
  }
  return d && d.kind === 'side' ? 0 : 1;
}

export function remainingCount(conflicts: GitSyncConflict[], decisions: Decisions): number {
  return conflicts.reduce((n, c) => n + remainingFor(c, decisions[conflictKey(c)]), 0);
}

/** Keep only decisions that still refer to a conflict exactly as it is now. */
export function reconcileDecisions(conflicts: GitSyncConflict[], decisions: Decisions): Decisions {
  const live = new Set(conflicts.map(conflictKey));
  const out: Decisions = {};
  for (const [k, v] of Object.entries(decisions)) if (live.has(k)) out[k] = v;
  return out;
}

/** The engine payload, or null while anything is undecided. */
export function buildResolutions(conflicts: GitSyncConflict[], decisions: Decisions): GitConflictResolution[] | null {
  const out: GitConflictResolution[] = [];
  for (const c of conflicts) {
    const d = decisions[conflictKey(c)];
    const base = { path: c.path, oursSha: c.oursSha, theirsSha: c.theirsSha };
    if (isTextConflict(c)) {
      if (!d || d.kind !== 'text') return null;
      const text = resultText(c, d);
      if (text === null) return null;
      out.push({ ...base, choice: 'content', content: text });
    } else {
      if (!d || d.kind !== 'side') return null;
      out.push({ ...base, choice: d.choice });
    }
  }
  return out;
}

/** Readable text for a line of HTML (tags and entities removed); plain text passes through. */
export function displayLine(line: string): string {
  if (!/[<&]/.test(line)) return line;
  const text = new DOMParser().parseFromString(line, 'text/html').body.textContent ?? '';
  // A line that is only markup (e.g. "</ul>") would otherwise render as nothing at all.
  return text.trim() === '' ? line : text;
}
