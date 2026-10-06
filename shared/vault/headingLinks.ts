/**
 * Keep `[[Note#Heading]]` links valid when a heading is renamed: every link that points at the old heading of the
 * note is rewritten to the new text. Pure text in, text out, like the note-rename rewrite (links.ts): the caller
 * decides which notes to read and how to write them back.
 */
import { splitInner, escapeText } from './links.js';
import { findHeadingIndex, headingLinkText, normalizeHeading } from './wikilink.js';
import type { LinkResolver } from './resolve.js';

export interface HeadingRename {
  /** Position of the heading among the note's headings, before the rename. */
  index: number;
  /** Its new text. */
  to: string;
}

export interface HeadingRewritePlan {
  /** The note whose headings changed, with ".md". */
  note: string;
  /** Its headings, in order, as they were before. */
  oldHeadings: readonly string[];
  renames: readonly HeadingRename[];
  resolver: LinkResolver;
}

/**
 * Rewrite the heading part of the links in `raw` (the content of note `source`) that point at a renamed heading of
 * `plan.note`. `A#B` (heading B under A) is followed too: any part of the path that names a renamed heading changes.
 * Two headings alike in a note: a link means the first, so only a rename of the first one moves its links.
 * Alias, embed mark and everything else about the link is left as it is.
 */
export function rewriteHeadingLinks(raw: string, plan: HeadingRewritePlan, source?: string): { content: string; changed: number } {
  if (plan.renames.length === 0) return { content: raw, changed: 0 };
  const headings = plan.oldHeadings.map(text => ({ text }));
  const byOld = new Map<string, string>();
  for (const { index, to } of plan.renames) {
    const old = plan.oldHeadings[index];
    if (old === undefined || findHeadingIndex(headings, old) !== index) continue;
    byOld.set(normalizeHeading(old), headingLinkText(to));
  }
  let changed = 0;
  const content = raw.replace(/\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
    const parts = splitInner(inner);
    if (!parts?.heading || parts.heading.startsWith('^')) return whole;
    const pointed = plan.resolver.resolve(parts.target, source);
    if (pointed?.toLowerCase() !== plan.note.toLowerCase()) return whole;
    let touched = false;
    const next = parts.heading.split('#').map(segment => {
      const replacement = byOld.get(normalizeHeading(segment));
      if (replacement === undefined || !replacement) return segment;
      touched = true;
      return replacement;
    }).join('#');
    if (!touched) return whole;
    changed++;
    const alias = parts.alias !== undefined ? `|${escapeText(parts.alias)}` : '';
    return `[[${escapeText(parts.target)}#${escapeText(next)}${alias}]]`;
  });
  return { content, changed };
}
