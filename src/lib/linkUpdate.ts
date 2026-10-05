/** Pure rules for the "update links on rename" setting and for coalescing title-driven renames. */

export type LinkUpdateMode = 'always' | 'ask' | 'never';

export interface PendingRename {
  from: string;
  to: string;
}

/** Anything unrecognised means the default, "always". */
export function readLinkUpdateMode(raw: unknown): LinkUpdateMode {
  return raw === 'ask' || raw === 'never' ? raw : 'always';
}

/**
 * Fold a new title-driven rename into the pending one. Retyping a title renames
 * the file again and again (A -> B -> C); links must be rewritten once, from the
 * ORIGINAL name to the final one.
 *   - continues the pending chain -> extend it
 *   - unrelated -> the pending one must be flushed first, then this one starts
 */
export function foldRename(
  pending: PendingRename | null,
  next: PendingRename,
): { pending: PendingRename; flush: PendingRename | null } {
  if (pending && pending.to === next.from) {
    return { pending: { from: pending.from, to: next.to }, flush: null };
  }
  return { pending: next, flush: pending };
}

const norm = (n: string) => n.replace(/\.md$/i, '').toLowerCase();

/** A chain that ended where it began (A -> B -> A) has nothing to rewrite. */
export function isNoopRename(r: PendingRename): boolean {
  return norm(r.from) === norm(r.to);
}
