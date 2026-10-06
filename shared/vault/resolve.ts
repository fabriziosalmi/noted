/**
 * Which note does a `[[link]]` point at? The rules are Obsidian's, so a vault opened from it keeps working:
 *  - case does not matter, and neither does a trailing ".md";
 *  - a link written with a path (`[[Work/Plan]]`) matches a note whose path ends with it;
 *  - a bare name (`[[Plan]]`) matches a note of that name wherever it sits in the vault;
 *  - when several notes fit, a note whose whole path is the link wins, then the one next to the note that
 *    holds the link, then the one with the shortest path (and the alphabetical first, so the answer never
 *    depends on the order the files were listed in);
 *  - a note's aliases (its frontmatter `aliases:`) are other names for it: a link that names no note by its
 *    path or name finds the note that has that alias, the same ties settled the same way.
 *
 * Pure, so the main process, the renderer and the rename rewrite give the same answer.
 */

export interface LinkResolver {
  /** The note name (with ".md") `target` points at, or null if there is no such note. `from` is the note holding the link. */
  resolve(target: string, from?: string): string | null;
}

const stemOf = (name: string): string => name.replace(/\.md$/i, '');
const lower = (s: string): string => s.toLowerCase();
const folderOf = (name: string): string => {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : lower(name.slice(0, i));
};

/** What a link target is compared as: no ".md", no stray slashes, lower case. */
export function normalizeTarget(target: string): string {
  return lower(stemOf(target.trim().replace(/^\/+|\/+$/g, '')));
}

function rank(a: string, b: string, fromFolder: string | null): number {
  if (fromFolder !== null) {
    const aNear = folderOf(a) === fromFolder ? 0 : 1;
    const bNear = folderOf(b) === fromFolder ? 0 : 1;
    if (aNear !== bNear) return aNear - bNear;
  }
  const depth = a.split('/').length - b.split('/').length;
  if (depth !== 0) return depth;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Note name -> its aliases. */
export type AliasMap = Readonly<Record<string, readonly string[]>>;

export function buildLinkResolver(names: Iterable<string>, aliases: AliasMap = {}): LinkResolver {
  const byStem = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  for (const name of names) {
    const stem = lower(stemOf(name));
    const base = stem.slice(stem.lastIndexOf('/') + 1);
    (byStem.get(stem) ?? byStem.set(stem, []).get(stem)!).push(name);
    (byBase.get(base) ?? byBase.set(base, []).get(base)!).push(name);
  }

  // alias (lower case) -> the notes that answer to it; only notes that exist count
  const byAlias = new Map<string, string[]>();
  const known = new Set<string>();
  for (const list of byStem.values()) for (const name of list) known.add(name);
  for (const [name, list] of Object.entries(aliases)) {
    if (!known.has(name)) continue;
    for (const alias of list) {
      const key = normalizeTarget(alias);
      if (!key) continue;
      const owners = byAlias.get(key) ?? byAlias.set(key, []).get(key)!;
      if (!owners.includes(name)) owners.push(name);
    }
  }

  const best = (candidates: string[], from?: string): string => {
    if (candidates.length === 1) return candidates[0];
    const fromFolder = from === undefined ? null : folderOf(from);
    return [...candidates].sort((a, b) => rank(a, b, fromFolder))[0];
  };

  return {
    resolve(target, from) {
      const t = normalizeTarget(target);
      if (!t) return null;
      const exact = byStem.get(t);
      if (exact) return best(exact, from);
      const base = t.slice(t.lastIndexOf('/') + 1);
      const sameName = byBase.get(base);
      if (sameName) {
        // "Work/Plan" also matches "Deep/Work/Plan.md": the link names the end of the path.
        const fits = t === base ? sameName : sameName.filter(n => lower(stemOf(n)).endsWith(`/${t}`));
        if (fits.length) return best(fits, from);
      }
      const owners = byAlias.get(t);
      return owners ? best(owners, from) : null;
    },
  };
}

/** Does `target`, written in the note `from`, point at the note `noteName`? */
export function linkPointsAtNote(resolver: LinkResolver, target: string, noteName: string, from?: string): boolean {
  return resolver.resolve(target, from) === noteName;
}
