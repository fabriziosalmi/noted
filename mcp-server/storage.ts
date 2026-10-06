// How the MCP server turns what an AI client sends into what is stored, and what is stored into what it
// shows, in either of the two vault formats (ADR 0001). The vault decides, not the note: a Markdown vault
// holds Markdown, an HTML vault holds HTML, and the app and this server agree because both ask the marker.
//
// A client may still send HTML to a Markdown vault (the previous contract, kept for one minor version);
// it is sanitized and converted. Markdown sent to an HTML vault goes through `marked` as before.
import { convertHtmlNote } from '../shared/markdown/migrate.js';
import { normalizeMarkdown, splitFrontmatter } from '../shared/markdown/codec.js';
import type { DomEnv } from '../shared/markdown/html.js';
import { markdownToPlainText } from '../shared/search/textExtract.js';
import type { NoteFormat } from '../shared/vault/format.js';

export interface StorageDeps {
  /** HTML-vault behaviour: Markdown or HTML in, sanitized HTML out. */
  toHtml(content: string): string;
  /** Plain text of an HTML note. */
  htmlToText(html: string): string;
  /** Removes scripts, handlers and unsafe URLs from HTML. */
  stripUnsafeHtml(html: string): string;
  /** A DOM to parse HTML with (jsdom, loaded on first use). */
  dom(): Promise<DomEnv>;
}

const looksLikeHtml = (s: string): boolean => s.replace(/^\uFEFF/, '').trimStart().startsWith('<');

/** What to write to the vault for text a client sent. */
export async function toStored(content: string, format: NoteFormat, deps: StorageDeps): Promise<string> {
  if (format === 'html') return deps.toHtml(content);
  if (looksLikeHtml(content)) return convertHtmlNote(deps.stripUnsafeHtml(content), await deps.dom()).text;
  return normalizeMarkdown(content);
}

/**
 * `existing` followed by `addition`, separated by a rule. Markdown: the existing text is left exactly as it
 * is (it may be someone's hand-written note, not ours to reformat) and only the addition is normalized.
 */
export async function appendStored(existing: string, addition: string, format: NoteFormat, deps: StorageDeps): Promise<string> {
  if (format === 'html') return `${existing}\n<hr>\n${deps.toHtml(addition)}`;
  // Front matter belongs at the top of a note: one sent with an addition would otherwise end up mid-document.
  const body = looksLikeHtml(addition) ? await toStored(addition, format, deps) : splitFrontmatter(addition).body;
  const head = existing.replace(/\s+$/, '');
  return head ? `${head}\n\n---\n\n${normalizeMarkdown(body)}` : normalizeMarkdown(body);
}

/** Plain text of a stored note, for search and for reading. */
export function storedToText(stored: string, format: NoteFormat, deps: Pick<StorageDeps, 'htmlToText'>): string {
  return format === 'html' ? deps.htmlToText(stored) : markdownToPlainText(stored);
}
