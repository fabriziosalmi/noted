/**
 * Sections of a Markdown note, found by their headings, and edits that touch only one: what an agent needs to change a
 * note's part without rewriting the whole text (and without having to quote it exactly). Pure, over the stored text.
 *
 * A section is a heading line and everything after it up to the next heading of the same or a higher level (so its
 * sub-sections belong to it), or the end of the note. Its own text is the part before its first sub-heading: editing
 * that leaves the sub-sections alone, which is what an edit of "the Risks section" almost always means. Headings inside the frontmatter or a fenced code block are not headings.
 * Only `#`-style headings are recognised; an underlined (setext) heading is ordinary text here.
 */
import { normalizeHeading } from '../vault/wikilink';

export interface Section {
  /** The heading's text as written (without the `#`s). */
  title: string;
  level: number;
  /** Index of the first character of the heading line. */
  start: number;
  /** Index just after the heading line, including its line break. */
  bodyStart: number;
  /** Index where the section ends: the next heading of the same or a higher level, or the end of the text. */
  end: number;
  /** Index where the section's own text ends: the next heading of any level, or the end of the text. */
  ownEnd: number;
  /** 1-based line number of the heading, for messages. */
  line: number;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;
const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Every heading of the note, in order, with where its section runs. */
export function sectionsOf(markdown: string): Section[] {
  const bom = markdown.startsWith('﻿') ? 1 : 0;
  const skip = bom + (FRONTMATTER.exec(markdown.slice(bom))?.[0].length ?? 0);
  const found: Omit<Section, 'end' | 'ownEnd'>[] = [];
  let fence: string | null = null;
  let at = 0;
  let line = 0;
  for (const raw of markdown.split('\n')) {
    line++;
    const lineStart = at;
    at += raw.length + 1;
    if (lineStart < skip) continue;
    const text = raw.replace(/\r$/, '');
    const fenced = FENCE.exec(text);
    if (fenced) {
      if (fence === null) fence = fenced[1];
      else if (fenced[1] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = HEADING.exec(text);
    if (m) found.push({ title: m[2], level: m[1].length, start: lineStart, bodyStart: Math.min(at, markdown.length), line });
  }
  return found.map((s, i) => {
    const next = found.slice(i + 1).find(n => n.level <= s.level);
    const following = found[i + 1];
    return { ...s, end: next ? next.start : markdown.length, ownEnd: following ? following.start : markdown.length };
  });
}

export type SectionLookup = { ok: true; section: Section } | { ok: false; error: string };

/**
 * The section a heading names. `heading` is the text (`Risks`, any level) or with its hashes (`## Risks`, that level only);
 * case, spacing and Markdown emphasis do not matter. More than one match is an error that lists them, unless `occurrence`
 * (1-based) says which.
 */
export function findSection(markdown: string, heading: string, occurrence?: number): SectionLookup {
  const asked = /^(#{1,6})[ \t]+(.+)$/.exec(heading.trim());
  const level = asked ? asked[1].length : undefined;
  const wanted = normalizeHeading(asked ? asked[2] : heading);
  if (!wanted) return { ok: false, error: 'the heading is empty' };
  const matches = sectionsOf(markdown).filter(s => normalizeHeading(s.title) === wanted && (level === undefined || s.level === level));
  if (matches.length === 0) return { ok: false, error: `no heading "${heading.trim()}" in this note` };
  if (occurrence !== undefined) {
    const picked = matches[occurrence - 1];
    return picked ? { ok: true, section: picked } : { ok: false, error: `there are ${matches.length} headings "${heading.trim()}", not ${occurrence}` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `"${heading.trim()}" matches ${matches.length} headings (lines ${matches.map(m => m.line).join(', ')}); say which with occurrence, or include the #s` };
  }
  return { ok: true, section: matches[0] };
}

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');
const withBreak = (text: string, eol: string): string => (text === '' || text.endsWith('\n') ? text : text + eol);

/** Where the part of a section that an edit touches ends: its own text, or with `whole` everything under it. */
const endOf = (section: Section, whole: boolean): number => (whole ? section.end : section.ownEnd);

/** The text of a section's body (what is under the heading line), without the heading. */
export function sectionBody(markdown: string, section: Section, whole = false): string {
  return markdown.slice(section.bodyStart, endOf(section, whole));
}

/**
 * The note with the body of the section replaced by `content`: its own text, or with `whole` its sub-sections too. The heading
 * line and everything after stay. The new body is set apart from the heading and from what follows by one blank line each, as
 * a hand-written note would have it.
 */
export function replaceSectionBody(markdown: string, section: Section, content: string, whole = false): string {
  const eol = eolOf(markdown);
  const end = endOf(section, whole);
  const body = content.replace(/^(?:\r?\n)+/, '').replace(/\s+$/, '');
  const after = markdown.slice(end);
  const head = withBreak(markdown.slice(section.start, section.bodyStart), eol);
  if (body === '') return markdown.slice(0, section.start) + head + (after === '' ? '' : eol) + after;
  return `${markdown.slice(0, section.start)}${head}${eol}${body}${eol}${after === '' ? '' : eol}${after}`;
}

/** The note with `content` added at the end of the section's own text (or with `whole`, of everything under it), a blank line between. */
export function appendToSectionBody(markdown: string, section: Section, content: string, whole = false): string {
  const eol = eolOf(markdown);
  const existing = markdown.slice(section.bodyStart, endOf(section, whole)).replace(/\s+$/, '');
  const added = content.replace(/^(?:\r?\n)+/, '').replace(/\s+$/, '');
  if (added === '') return markdown;
  return replaceSectionBody(markdown, section, existing === '' ? added : `${existing.replace(/^(?:\r?\n)+/, '')}${eol}${eol}${added}`, whole);
}
