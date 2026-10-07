// A note cut into the pieces that are embedded and retrieved: one or more per heading, small enough for an embedding
// model, each knowing where it sits ("Title › Plan › Risks"). Pure and deterministic: the same note always gives the same
// chunks, so a chunk's hash says whether it changed. Works on both formats a vault can hold (Markdown, and the HTML of
// vaults not yet converted).

import { htmlToPlainText, markdownToPlainText } from './textExtract';

/** A chunk's text stays under this many characters (about 400 tokens: well inside every embedding model's window). */
export const MAX_CHUNK_CHARS = 1500;
/** A note that would give more chunks than this is cut off there: the cap is a safety net, not a working limit. */
export const MAX_CHUNKS_PER_NOTE = 400;

export interface NoteChunk {
  /** Position in the note, from 0. */
  ord: number;
  /** The headings above this text, outermost first (the note's own title heading is left out). */
  headingPath: string[];
  /** The text, as plain prose. */
  text: string;
}

const SEPARATOR = ' › ';

/** What is embedded for a chunk: its place first, so "Risks" under "Launch" is not mistaken for "Risks" under "Hiring". */
export function embedText(title: string, chunk: Pick<NoteChunk, 'headingPath' | 'text'>): string {
  return `${[title, ...chunk.headingPath].join(SEPARATOR)}\n\n${chunk.text}`;
}

const looksLikeHtml = (s: string): boolean => s.trimStart().startsWith('<');
const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

interface Section { path: string[]; body: string }

/** The headings stack: entering a heading of level L drops every heading of level L or deeper. */
class Outline {
  private stack: { level: number; title: string }[] = [];
  enter(level: number, title: string): string[] {
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= level) this.stack.pop();
    this.stack.push({ level, title });
    return this.stack.map(h => h.title);
  }
}

function markdownSections(raw: string): Section[] {
  const text = raw.replace(/^\uFEFF/, '').replace(FRONTMATTER, '');
  const sections: Section[] = [];
  const outline = new Outline();
  let path: string[] = [];
  let lines: string[] = [];
  let fence: string | null = null;
  const flush = () => { sections.push({ path, body: lines.join('\n') }); lines = []; };
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const h = fence === null ? ATX.exec(line) : null;
    if (h) {
      flush();
      path = outline.enter(h[1].length, markdownToPlainText(h[2]) || h[2].trim());
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function htmlSections(raw: string): Section[] {
  const html = raw.replace(/<!--[\s\S]*?-->/g, ' ');
  const sections: Section[] = [];
  const outline = new Outline();
  const heading = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let path: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = heading.exec(html)) !== null) {
    sections.push({ path, body: html.slice(last, m.index) });
    path = outline.enter(Number(m[1]), htmlToPlainText(m[2]));
    last = m.index + m[0].length;
  }
  sections.push({ path, body: html.slice(last) });
  return sections;
}

/** The plain-text stripper leaves "tests ." where the note had "**tests**."; this text is read by a model and quoted to people. */
const tidy = (text: string): string => text.replace(/[ \t]+([.,])/g, '$1');

/** Paragraph-like blocks of a Markdown body: blank lines separate them, except inside a code fence. */
function markdownBlocks(body: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const end = () => { if (current.length > 0) blocks.push(current.join('\n')); current = []; };
  for (const line of body.split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    if (fence === null && line.trim() === '' && !f) end();
    else current.push(line);
  }
  end();
  return blocks.map(b => tidy(markdownToPlainText(b))).filter(Boolean);
}

/** A block longer than the limit, cut at sentence ends where there are any, else at spaces, else anywhere. */
function splitLong(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('。'));
    if (cut < max * 0.4) cut = window.lastIndexOf(' ');
    if (cut < max * 0.4) cut = max - 1; // no break to speak of: cut inside the word
    pieces.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/** Greedy packing of blocks into chunks of at most `max` characters. */
function pack(blocks: string[], max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks.flatMap(b => (b.length > max ? splitLong(b, max) : [b]))) {
    if (current && current.length + 1 + block.length > max) { chunks.push(current); current = block; }
    else current = current ? `${current}\n${block}` : block;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** The chunks of a note file. `title` is the note's own title: a first heading that repeats it is not a section of its own. */
export function chunkNote(title: string, raw: string, max = MAX_CHUNK_CHARS): NoteChunk[] {
  const html = looksLikeHtml(raw);
  const sections = html ? htmlSections(raw) : markdownSections(raw);
  const sameAsTitle = (s: string) => s.trim().toLowerCase() === title.trim().toLowerCase();
  const out: NoteChunk[] = [];
  for (const section of sections) {
    const path = section.path.length > 0 && sameAsTitle(section.path[0]) ? section.path.slice(1) : section.path;
    const blocks = html ? [tidy(htmlToPlainText(section.body))].filter(Boolean) : markdownBlocks(section.body);
    for (const text of pack(blocks, max)) {
      if (out.length >= MAX_CHUNKS_PER_NOTE) return out;
      out.push({ ord: out.length, headingPath: path, text });
    }
  }
  return out;
}
