/**
 * Pure extraction of what a note links to and is about: wikilinks, tags,
 * headings and frontmatter keys. One implementation, used by the main-process
 * VaultIndex and by the renderer, so "what counts as a tag or a link" cannot
 * drift between the index and the editor.
 *
 * A note is HTML inside a .md file (vaults created before ADR 0001) or Markdown. Every function takes the
 * raw file text; the ones that depend on the format take it too, and when it is not given they sniff it.
 * The caller that knows the vault's format should pass it: a Markdown note can start with `<`
 * (an HTML block, an autolink) without being HTML.
 */

import { extractHtmlFrontmatterComment, extractMarkdownFrontmatter } from '../markdown/frontmatter.js';
import type { NoteFormat } from './format.js';
import { aliasesFromFrontmatter } from './aliases.js';
import { fieldsFromFrontmatter, type FieldValue } from './fields.js';

export interface WikiLink {
  /** Note the link points at, without alias/heading/".md": "Folder/Note". */
  target: string;
  /** `[[Target|alias]]` */
  alias?: string;
  /** `[[Target#Heading]]` */
  heading?: string;
}

export interface Heading {
  level: number;
  text: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENTITIES[m] ?? m);
}

const looksLikeHtml = (s: string, format?: NoteFormat) => (format ? format === 'html' : s.trimStart().startsWith('<'));

/** Body of a note with its frontmatter (either flavour) removed. */
function bodyAndFrontmatter(raw: string, format?: NoteFormat): { body: string; frontmatter: string | null } {
  if (looksLikeHtml(raw, format)) {
    const { body, frontmatter } = extractHtmlFrontmatterComment(raw);
    return { body, frontmatter };
  }
  const { body, frontmatter } = extractMarkdownFrontmatter(raw);
  return { body, frontmatter };
}

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

/**
 * Every `[[...]]` in the note, in order, duplicates kept (callers that only need
 * the set of targets dedupe; a rewrite needs every occurrence).
 */
export function parseWikilinks(raw: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of raw.matchAll(WIKILINK_RE)) {
    const inner = decodeEntities(m[1]);
    const pipe = inner.indexOf('|');
    const head = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
    const hash = head.indexOf('#');
    const target = (hash === -1 ? head : head.slice(0, hash)).trim().replace(/\.md$/i, '');
    const heading = hash === -1 ? undefined : head.slice(hash + 1).trim() || undefined;
    if (!target) continue; // "[[#Heading]]" and "[[ ]]" point at no other note
    out.push({ target, ...(alias ? { alias } : {}), ...(heading ? { heading } : {}) });
  }
  return out;
}

/** Distinct link targets, in order of first appearance. */
export function linkTargets(raw: string): string[] {
  return [...new Set(parseWikilinks(raw).map(l => l.target))];
}

/**
 * #tags, lowercased and distinct. One optional namespace segment is allowed
 * (#project/aurora); a second slash is not part of the tag. HTML tags and
 * character references (`&#39;` is not the tag "#39") are ignored.
 */
export function extractTags(content: string, format?: NoteFormat): string[] {
  // A Markdown note's YAML frontmatter is data, not text ("# a comment" in it is not a tag).
  const body = format === 'markdown' ? extractMarkdownFrontmatter(content).body : content;
  // A link's "#Heading" anchor ([[Note#Setup]]) is not a tag, so links are dropped first.
  const text = body
    .replace(/\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#?\w+;/g, m => (m in ENTITIES ? ENTITIES[m] : ' '));
  const matches = text.match(/#([a-zA-Z0-9_\-àèéìòùÀÈÉÌÒÙ]+(?:\/[a-zA-Z0-9_\-àèéìòùÀÈÉÌÒÙ]+)?)/g) ?? [];
  return [...new Set(matches.map(t => t.toLowerCase()))];
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Headings in document order: <h1>-<h6> for HTML notes, `#`-lines (outside code fences) for Markdown. */
export function extractHeadings(raw: string, format?: NoteFormat): Heading[] {
  const { body } = bodyAndFrontmatter(raw, format);
  const out: Heading[] = [];
  if (looksLikeHtml(raw, format)) {
    for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const text = stripTags(m[2]);
      if (text) out.push({ level: Number(m[1]), text });
    }
    return out;
  }
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/** Top-level keys of the note's YAML frontmatter, if any. */
export function extractFrontmatterKeys(raw: string, format?: NoteFormat): string[] {
  const { frontmatter } = bodyAndFrontmatter(raw, format);
  if (!frontmatter) return [];
  const keys: string[] = [];
  for (const line of frontmatter.split('\n')) {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*:/.exec(line);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/** Does a link target point at this note? Case-insensitive, with or without ".md". */
export function linkPointsAt(target: string, noteName: string): boolean {
  const norm = (s: string) => s.replace(/\.md$/i, '').toLowerCase();
  return norm(target) === norm(noteName);
}

/** The note's frontmatter as typed fields (see fields.ts), the rows of a view. */
export function extractFields(raw: string, format?: NoteFormat): Record<string, FieldValue> {
  return fieldsFromFrontmatter(bodyAndFrontmatter(raw, format).frontmatter);
}

/** The note's aliases (frontmatter `aliases:`), the other names `[[links]]` and Quick Open know it by. */
export function extractAliases(raw: string, format?: NoteFormat): string[] {
  return aliasesFromFrontmatter(bodyAndFrontmatter(raw, format).frontmatter);
}
