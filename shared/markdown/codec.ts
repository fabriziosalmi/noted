// The Markdown <-> document codec (ADR 0001). A note on disk is an optional YAML frontmatter block
// followed by a Markdown body; the body is what the editor works on.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdownBody } from './parser';
import { documentSchema } from './schema';
import { serializeMarkdownBody } from './serializer';

export { documentSchema, documentExtensions } from './schema';

const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface SplitNote {
  /** The exact bytes of the leading `---` block, including its closing line; '' if there is none. */
  frontmatter: string;
  body: string;
}

/**
 * Separate the frontmatter from the body without touching either: the block is never parsed or
 * re-serialized by the editor, so whatever the user wrote (comments, odd spacing, unknown keys) comes back identical.
 */
export function splitFrontmatter(input: string): SplitNote {
  const text = input.replace(/^\uFEFF/, ''); // a byte-order mark is not content
  const m = FRONTMATTER.exec(text);
  return m ? { frontmatter: m[0], body: text.slice(m[0].length) } : { frontmatter: '', body: text };
}

export interface ParsedNote {
  frontmatter: string;
  doc: PMNode;
}

export function parseNote(text: string): ParsedNote {
  const { frontmatter, body } = splitFrontmatter(text);
  return { frontmatter, doc: parseMarkdownBody(body) };
}

/** Frontmatter, one blank line, the body, one trailing newline. An empty body leaves just the frontmatter. */
export function serializeNote({ frontmatter, doc }: ParsedNote): string {
  const body = serializeMarkdownBody(doc).replace(/\n+$/, '');
  const head = frontmatter ? frontmatter.replace(/\r?\n?$/, '\n') : '';
  if (!body) return head;
  return head ? `${head}\n${body}\n` : `${body}\n`;
}

/** What saving `text` through the editor would write: the codec applied once. */
export function normalizeMarkdown(text: string): string {
  return serializeNote(parseNote(text));
}

const WIKILINK_IN_TEXT = /(!?)\[\[([^\]|#^\n]+?)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;

/** Plain text as inline content: a typed `[[Note]]` is a link, as it is in the editor, everything else is literal. */
function plainInline(line: string): object[] {
  const out: object[] = [];
  let last = 0;
  for (const m of line.matchAll(WIKILINK_IN_TEXT)) {
    if (m.index > last) out.push({ type: 'text', text: line.slice(last, m.index) });
    out.push({ type: 'text', text: m[0], marks: [{ type: 'wikilink', attrs: { target: m[2].trim(), embed: m[1] === '!' } }] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) });
  return out;
}

/** A note holding plain text, one paragraph per non-empty line (quick capture): every character written as typed. */
export function plainTextToMarkdown(text: string): string {
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ type: 'paragraph', content: plainInline(line) }));
  if (paragraphs.length === 0) return '';
  const doc = documentSchema().nodeFromJSON({ type: 'doc', content: paragraphs });
  return serializeNote({ frontmatter: '', doc });
}
