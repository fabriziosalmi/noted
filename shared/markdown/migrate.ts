// Converting a note between the two on-disk formats (ADR 0001), and saying honestly what the conversion
// kept. Pure: the DOM is passed in (jsdom in the main process, a real one in tests of the renderer).
import type { Node as PMNode } from '@tiptap/pm/model';
import { documentSchema } from './schema';
import { parseNote, serializeNote } from './codec';
import { docToHtml, htmlToDoc, type DomEnv } from './html';
import { extractHtmlFrontmatterComment, prependFrontmatterComment } from './frontmatter';

/**
 * - `exact`      every word and every construct survived;
 * - `raw`        every word survived; parts the editor cannot show (<details>, <iframe>, <sup>...) are kept as written, as raw HTML;
 * - `formatting` every word survived, some presentation did not (colours, fonts, merged cells);
 * - `lossy`      words differ: something that was text is not in the converted note.
 */
export type Verdict = 'exact' | 'raw' | 'formatting' | 'lossy';

export interface Conversion {
  /** The note as it will be written. */
  text: string;
  verdict: Verdict;
  /** One short sentence per thing that did not survive or was kept raw. */
  findings: string[];
}

/** Does the file look like a note written by earlier versions (HTML, optionally behind a frontmatter comment)? */
export function isLegacyHtml(raw: string): boolean {
  return raw.replace(/^\uFEFF/, '').trimStart().startsWith('<');
}

// Elements the editor writes and the document model holds.
const KNOWN = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'i', 'strong', 'b', 's', 'del', 'strike',
  'u', 'mark', 'a', 'img', 'hr', 'br', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'div', 'span', 'input', 'label',
]);
// Unknown elements that sit inside a line of text; any other unknown element is a block.
const INLINE_UNKNOWN = new Set([
  'sup', 'sub', 'kbd', 'small', 'abbr', 'cite', 'q', 'dfn', 'var', 'samp', 'time', 'font', 'ins', 'bdi', 'bdo', 'ruby', 'rt', 'rp', 'wbr', 'big', 'tt', 'data', 'output', 'label',
]);
// Classes and attributes the editor itself writes (not styling someone added).
const OWN_CLASS = /^(wikilink|language-.*|hljs.*|has-focus|ProseMirror.*|task-.*|tableWrapper|selectedCell|column-resize-handle)$/;
const OWN_STYLE_TAGS = new Set(['table', 'col', 'colgroup', 'td', 'th']);

const squash = (s: string): string => s.replace(/[\s\u200b\ufeff]+/g, '');

/**
 * Elements the document model has no node for are kept verbatim as raw HTML (a raw block or inline node),
 * not unwrapped to their text, so nothing about them is lost. Returns what was kept and what was dropped.
 */
function preserveUnknown(body: HTMLElement, env: Pick<DomEnv, 'document'>): { raw: string[]; dropped: string[] } {
  const raw = new Map<string, number>();
  const dropped = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const walk = (el: Element): void => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (!KNOWN.has(tag)) {
        const inline = INLINE_UNKNOWN.has(tag);
        const holder = env.document.createElement(inline ? 'span' : 'pre');
        holder.setAttribute(inline ? 'data-raw-inline' : 'data-raw-block', '');
        holder.textContent = child.outerHTML;
        child.replaceWith(holder);
        bump(raw, `<${tag}>`);
        continue;
      }
      if (child.hasAttribute('style') && !OWN_STYLE_TAGS.has(tag)) bump(dropped, 'inline styles dropped');
      if ([...child.classList].some((c) => !OWN_CLASS.test(c))) bump(dropped, 'custom classes dropped');
      if ((tag === 'td' || tag === 'th') && (Number(child.getAttribute('colspan') ?? 1) > 1 || Number(child.getAttribute('rowspan') ?? 1) > 1)) bump(dropped, 'merged table cells unmerged');
      walk(child);
    }
  };
  walk(body);
  const list = (m: Map<string, number>, suffix: string) => [...m].map(([k, n]) => `${k}${suffix}${n > 1 ? ` (${n}×)` : ''}`);
  return { raw: list(raw, ' kept as raw HTML'), dropped: list(dropped, '') };
}

/** Every word of a document, with the words inside raw HTML counted (decoded the way a browser would). */
function wordsOf(doc: PMNode, env: Pick<DomEnv, 'document'>): string {
  let out = '';
  doc.descendants((node) => {
    if (node.isText) out += node.text;
    else if (node.type.name === 'rawBlock' || node.type.name === 'rawInline') {
      const holder = env.document.createElement('div');
      holder.innerHTML = String(node.attrs.raw);
      out += holder.textContent ?? '';
    }
    return true;
  });
  return out;
}

/**
 * The words of an HTML note. What the editor wrote for raw HTML it kept (a <pre data-raw-block> or <span data-raw-inline>
 * whose text is the raw HTML itself) counts as the words of that HTML, as it does when the same node is in a document.
 */
function wordsOfHtml(holder: HTMLElement, env: Pick<DomEnv, 'document'>): string {
  const copy = holder.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll('[data-raw-block], [data-raw-inline]')) {
    const probe = env.document.createElement('div');
    probe.innerHTML = el.textContent ?? '';
    el.textContent = probe.textContent ?? '';
  }
  return copy.textContent ?? '';
}

/** Whether `doc` carries every word of `html`; on a difference, a short sample of where it starts. */
function textDifference(source: string, doc: PMNode, env: Pick<DomEnv, 'document'>): string | null {
  const before = squash(source);
  const after = squash(wordsOf(doc, env));
  if (before === after) return null;
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  return `text differs near "${before.slice(Math.max(0, i - 15), i + 25)}"`;
}

/** Legacy HTML note -> Markdown note, with a report of what the conversion kept. */
export function convertHtmlNote(raw: string, env: DomEnv): Conversion {
  const { frontmatter, body } = extractHtmlFrontmatterComment(raw.replace(/^\uFEFF/, ''));
  const holder = new env.DOMParser().parseFromString(`<body>${body}</body>`, 'text/html').body;
  const sourceText = wordsOfHtml(holder, env);
  const { raw: kept, dropped } = preserveUnknown(holder, env);
  const doc = htmlToDoc(holder.innerHTML, documentSchema(), env, false);
  const text = serializeNote({ frontmatter: frontmatter ?? '', doc });

  const findings = [...kept, ...dropped];
  const diff = textDifference(sourceText, doc, env);
  if (diff) findings.unshift(diff);
  // Writing it again must change nothing (the codec's own guarantee, checked on this very note).
  if (serializeNote(parseNote(text)) !== text) findings.unshift('did not read back identically');
  const verdict: Verdict = diff || findings[0]?.startsWith('did not read back') ? 'lossy' : dropped.length ? 'formatting' : kept.length ? 'raw' : 'exact';
  return { text, verdict, findings };
}

/** Markdown note -> the HTML the app used to store (the way back, and what an HTML vault holds). */
export function convertMarkdownNoteToHtml(raw: string, env: Pick<DomEnv, 'document'>): string {
  const { frontmatter, doc } = parseNote(raw);
  return prependFrontmatterComment(docToHtml(doc, env), frontmatter || null);
}
