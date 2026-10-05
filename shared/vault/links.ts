/**
 * Rewrite wikilinks when notes are renamed or moved, so no link is left pointing
 * at a name that no longer exists. Pure text in, text out: the caller decides
 * which notes to read and how to write them back.
 *
 * The editor stores a link as `<span data-wikilink="Target">[[Target]]</span>`
 * (HTML-escaped), so both the visible `[[...]]` text and the attribute change.
 * Alias (`[[Old|shown]]`) and heading (`[[Old#Setup]]`) parts are preserved.
 */

import { decodeEntities, linkPointsAt } from './extract.js';

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

function renameFor(target: string, renames: NoteRename[]): NoteRename | undefined {
  return renames.find(r => linkPointsAt(target, r.from));
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
 * Apply every rename at once to the links in `raw`. A link whose target matches
 * `from` (case-insensitively, with or without ".md") is rewritten to `to`
 * (without ".md"); everything else, including text that merely looks similar, is
 * left byte-for-byte alone.
 */
export function rewriteWikilinks(raw: string, renames: NoteRename[]): RewriteResult {
  if (renames.length === 0) return { content: raw, changed: 0 };
  let changed = 0;

  // 1. The visible [[...]] text.
  let content = raw.replace(/\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
    const parts = splitInner(inner);
    if (!parts) return whole;
    const r = renameFor(parts.target, renames);
    if (!r) return whole;
    changed++;
    const heading = parts.heading !== undefined ? `#${escapeText(parts.heading)}` : '';
    const alias = parts.alias !== undefined ? `|${escapeText(parts.alias)}` : '';
    return `[[${escapeText(bare(r.to))}${heading}${alias}]]`;
  });

  // 2. The editor's data-wikilink attribute (the link target as a mark attribute).
  content = content.replace(/(\bdata-wikilink=")([^"]*)(")/g, (whole, open: string, value: string, close: string) => {
    const target = decodeEntities(value).trim();
    const r = renameFor(target, renames);
    return r ? `${open}${escapeAttr(bare(r.to))}${close}` : whole;
  });

  return { content, changed };
}
