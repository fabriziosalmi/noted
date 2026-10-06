/**
 * Unlinked mentions (#69): places in a note where another note's title (or alias) is written as plain text, and
 * turning one into a `[[link]]`. Works on the note as stored (Markdown, or the HTML older vaults hold), and is careful
 * about where text is really text: never in front matter, code, an existing link, a URL, markup, a tag, or math.
 * Pure: the caller reads and writes the note.
 */
import type { NoteFormat } from './format';

export interface Mention {
  /** Offsets into the note as stored. */
  start: number;
  end: number;
  /** The text as written there. */
  text: string;
  /** Which of the names it matched. */
  phrase: string;
}

type Range = [number, number];

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm;

function push(into: Range[], regex: RegExp, text: string): void {
  for (const m of text.matchAll(regex)) into.push([m.index, m.index + m[0].length]);
}

/** Stretches of a Markdown note that are not prose. */
function protectedMarkdown(raw: string): Range[] {
  const ranges: Range[] = [];
  const front = FRONTMATTER.exec(raw);
  if (front) ranges.push([0, front[0].length]);

  // fenced code: from an opening fence to the closing fence of the same character (or the end)
  let open: { char: string; length: number; at: number } | null = null;
  for (const m of raw.matchAll(FENCE)) {
    const fence = m[1];
    if (!open) open = { char: fence[0], length: fence.length, at: m.index };
    else if (fence[0] === open.char && fence.length >= open.length && /^[ \t]{0,3}[`~]+[ \t]*$/.test(m[0])) {
      ranges.push([open.at, m.index + m[0].length]);
      open = null;
    }
  }
  if (open) ranges.push([open.at, raw.length]);

  push(ranges, /``+[\s\S]*?``+|`[^`\n]*`/g, raw); // inline code
  push(ranges, /!?\[\[[^\]\n]*\]\]/g, raw); // wikilinks and embeds
  push(ranges, /!?\[[^\]\n]*\]\([^)\n]*\)/g, raw); // links and images, text and destination
  push(ranges, /!?\[[^\]\n]*\]\[[^\]\n]*\]/g, raw); // reference links
  push(ranges, /^[ \t]{0,3}\[[^\]\n]+\]:.*$/gm, raw); // reference definitions
  push(ranges, /\[\^[^\]\n]+\]/g, raw); // footnote references
  push(ranges, /<[A-Za-z!/][^>\n]*>/g, raw); // inline HTML and autolinks
  push(ranges, /<!--[\s\S]*?-->/g, raw);
  push(ranges, /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi, raw); // URLs
  push(ranges, /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, raw); // math
  push(ranges, /%%[\s\S]*?%%/g, raw); // Obsidian comments
  return ranges;
}

/** Stretches of an HTML note that are not prose: every tag, and the content of code, links and scripts. */
function protectedHtml(raw: string): Range[] {
  const ranges: Range[] = [];
  push(ranges, /<!--[\s\S]*?-->/g, raw);
  push(ranges, /<[A-Za-z!/][^>]*>/g, raw);
  push(ranges, /<(code|pre|a|script|style|kbd)\b[\s\S]*?<\/\1\s*>/gi, raw);
  push(ranges, /<span\b[^>]*data-wikilink[^>]*>[\s\S]*?<\/span>/gi, raw);
  push(ranges, /!?\[\[[^\]\n]*\]\]/g, raw); // links typed as text
  push(ranges, /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi, raw);
  return ranges;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for a name: any case, spaces in it match any run of whitespace, and it must be a whole word (or words). */
function patternFor(phrase: string): RegExp {
  const body = phrase.trim().split(/\s+/).map(escapeRegex).join('\\s+');
  // not glued to letters, digits or underscores, and not a #tag
  return new RegExp(`(?<![\\p{L}\\p{N}_#@/])${body}(?![\\p{L}\\p{N}_])`, 'giu');
}

/** Names too short or too plain to mean anything as a mention ("a", "of"). */
export const MIN_MENTION_CHARS = 3;
export const usablePhrase = (phrase: string): boolean => {
  const p = phrase.trim();
  return p.length >= MIN_MENTION_CHARS && !/[<>&"]/.test(p) && /[\p{L}\p{N}]/u.test(p);
};

const covered = (ranges: readonly Range[], start: number, end: number): boolean => ranges.some(([a, b]) => start < b && end > a);

/**
 * Every place any of `phrases` is written as plain text, in order and not overlapping (at one spot the longest name
 * wins), outside everything that is not prose.
 */
export function findMentions(raw: string, phrases: readonly string[], format: NoteFormat): Mention[] {
  const usable = [...new Set(phrases.filter(usablePhrase).map(p => p.trim()))].sort((a, b) => b.length - a.length);
  if (usable.length === 0) return [];
  const skip = format === 'html' ? protectedHtml(raw) : protectedMarkdown(raw);
  const found: Mention[] = [];
  for (const phrase of usable) {
    for (const m of raw.matchAll(patternFor(phrase))) {
      const start = m.index;
      const end = start + m[0].length;
      if (covered(skip, start, end)) continue;
      if (found.some(f => start < f.end && end > f.start)) continue; // a longer name already took this spot
      found.push({ start, end, text: m[0], phrase });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The note with this mention turned into a link: `[[Target]]`, or `[[Target|text]]` when the text differs from the target. */
export function linkMention(raw: string, mention: Mention, target: string, format: NoteFormat): string {
  const shown = raw.slice(mention.start, mention.end);
  const link = shown === target ? `[[${target}]]` : `[[${target}|${shown}]]`;
  // An HTML vault keeps a link as the editor's own span, so it is a link there and not text that looks like one.
  const written = format === 'html'
    ? `<span data-wikilink="${target.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" class="wikilink">${link.replace(/&/g, '&amp;')}</span>`
    : link;
  return raw.slice(0, mention.start) + written + raw.slice(mention.end);
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** A line of context around a mention, as plain text: markup stripped, whitespace collapsed. */
export function snippetAround(raw: string, mention: Mention, format: NoteFormat, radius = 70): Snippet {
  const plain = (s: string): string => {
    const text = format === 'html' ? s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : s.replace(/[*_`#>]+/g, '');
    return text.replace(/\s+/g, ' ');
  };
  const before = plain(raw.slice(Math.max(0, mention.start - radius), mention.start)).trimStart();
  const after = plain(raw.slice(mention.end, mention.end + radius)).trimEnd();
  return {
    before: (mention.start > radius ? '…' : '') + before,
    match: mention.text,
    after: after + (mention.end + radius < raw.length ? '…' : ''),
  };
}
