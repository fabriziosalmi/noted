/**
 * Rewrite wikilinks when notes are renamed or moved, so no link is left pointing
 * at a name that no longer exists. Pure text in, text out: the caller decides
 * which notes to read and how to write them back.
 *
 * The editor stores a link as `<span data-wikilink="Target">[[Target]]</span>`
 * (HTML-escaped), so both the visible `[[...]]` text and the attribute change.
 * Alias (`[[Old|shown]]`) and heading (`[[Old#Setup]]`) parts are preserved.
 */

import { decodeEntities } from './extract.js';
import { buildLinkResolver, type LinkResolver } from './resolve.js';

export interface NoteRename {
  /** Old note name with extension, e.g. "Work/Plan.md". */
  from: string;
  /** New note name with extension. */
  to: string;
}

export interface RewriteResult {
  content: string;
  /** Number of links changed. */
  changed: number;
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');
const bare = (name: string) => name.replace(/\.md$/i, '');

/**
 * Who a link pointed at before the rename, and the shortest way to write it afterwards. Resolution follows
 * Obsidian's rules (shared/vault/resolve.ts), so `[[Plan]]` for `Work/Plan.md` is found, and a link that still
 * resolves to the renamed note after the move (same name, another folder) is left alone.
 */
export interface RewritePlan {
  renames: NoteRename[];
  /** The vault as it was before the renames, and as it is after them. */
  before: LinkResolver;
  after: LinkResolver;
  /** A note's name before / after the renames (the note holding a link may itself have been renamed). */
  nameBefore(name: string): string;
  nameAfter(name: string): string;
}

/**
 * `names` are the vault's notes now. It does not matter whether the files were already renamed or not: the
 * vault before the renames has every `from` and no `to`, the one after has every `to` and no `from`.
 */
export function prepareRewrite(renames: NoteRename[], names: readonly string[] = []): RewritePlan {
  const from = new Map(renames.map(r => [r.from.toLowerCase(), r]));
  const to = new Map(renames.map(r => [r.to.toLowerCase(), r]));
  const keep = (n: string, drop: Map<string, NoteRename>) => !drop.has(n.toLowerCase());
  const before = [...names.filter(n => keep(n, to)), ...renames.map(r => r.from)];
  const after = [...names.filter(n => keep(n, from)), ...renames.map(r => r.to)];
  return {
    renames,
    before: buildLinkResolver(before),
    after: buildLinkResolver(after),
    nameBefore: n => to.get(n.toLowerCase())?.from ?? n,
    nameAfter: n => from.get(n.toLowerCase())?.to ?? n,
  };
}

/** The new text for a link, or null when it needs none. `source` is the note that holds the link. */
function newTargetFor(target: string, plan: RewritePlan, source?: string): string | null {
  const sourceBefore = source === undefined ? undefined : plan.nameBefore(source);
  const pointed = plan.before.resolve(target, sourceBefore);
  const rename = pointed === null ? undefined : plan.renames.find(r => r.from.toLowerCase() === pointed.toLowerCase());
  if (!rename) return null;
  const sourceAfter = source === undefined ? undefined : plan.nameAfter(source);
  // Still pointing at the same note, wherever it is now: nothing to write.
  if (plan.after.resolve(target, sourceAfter)?.toLowerCase() === rename.to.toLowerCase()) return null;
  const full = bare(rename.to);
  const base = full.slice(full.lastIndexOf('/') + 1);
  // A bare name stays bare when that still finds the note; a path is written as a path.
  if (!target.includes('/') && plan.after.resolve(base, sourceAfter)?.toLowerCase() === rename.to.toLowerCase()) return base;
  return full;
}

/** Parse the inside of `[[...]]` into target / heading / alias (all entity-decoded). */
function splitInner(inner: string): { target: string; heading?: string; alias?: string } | null {
  const decoded = decodeEntities(inner);
  const pipe = decoded.indexOf('|');
  const head = (pipe === -1 ? decoded : decoded.slice(0, pipe)).trim();
  const alias = pipe === -1 ? undefined : decoded.slice(pipe + 1);
  const hash = head.indexOf('#');
  const target = (hash === -1 ? head : head.slice(0, hash)).trim();
  if (!target) return null;
  return { target, heading: hash === -1 ? undefined : head.slice(hash + 1), alias };
}

/**
 * Apply every rename at once to the links in `raw`. A link that pointed at a renamed note is rewritten
 * to the shortest text that points at its new name; everything else, including text that merely looks
 * similar, is left byte-for-byte alone.
 */
export function rewriteWikilinks(
  raw: string,
  renames: NoteRename[],
  /** `prepareRewrite(renames, vaultNames)` for the whole vault; without it only the renamed notes are known. */
  plan: RewritePlan = prepareRewrite(renames),
  /** The note holding these links. */
  source?: string,
): RewriteResult {
  if (renames.length === 0) return { content: raw, changed: 0 };
  let changed = 0;

  // 1. The visible [[...]] text.
  let content = raw.replace(/\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
    const parts = splitInner(inner);
    if (!parts) return whole;
    const target = newTargetFor(parts.target, plan, source);
    if (target === null) return whole;
    changed++;
    const heading = parts.heading !== undefined ? `#${escapeText(parts.heading)}` : '';
    const alias = parts.alias !== undefined ? `|${escapeText(parts.alias)}` : '';
    return `[[${escapeText(target)}${heading}${alias}]]`;
  });

  // 2. The editor's data-wikilink attribute (the link target as a mark attribute).
  content = content.replace(/(\bdata-wikilink=")([^"]*)(")/g, (whole, open: string, value: string, close: string) => {
    const next = newTargetFor(decodeEntities(value).trim(), plan, source);
    return next === null ? whole : `${open}${escapeAttr(next)}${close}`;
  });

  return { content, changed };
}
