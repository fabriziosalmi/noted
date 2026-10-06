// What `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]` show in place: the note's content, the section under a
// heading, or the one block. Pure over the note's HTML, so the rules are tested without a screen.
import { findHeadingIndex } from '../../shared/vault/wikilink';
import { sanitizeHtml } from './sanitizeHtml';

const HEADING = /^H[1-6]$/;
const BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6';
const levelOf = (el: Element): number => Number(el.tagName.slice(1));
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Top-level children of the note's HTML, in order. */
function blocksOf(html: string): Element[] {
  const root = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  return [...root.children];
}

/** The last piece of text inside a node, where a block's `^id` sits. */
function lastText(node: Node): Text | null {
  for (let n = node.lastChild; n; n = n.previousSibling) {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) return n as Text;
    const inner = lastText(n);
    if (inner) return inner;
  }
  return null;
}

/** The innermost block whose text ends with `^block`, without the id; null when there is none. */
function blockHtml(blocks: Element[], block: string): string | null {
  const marker = new RegExp(`(?:^|\\s)\\^${escapeRegExp(block)}\\s*$`);
  for (const top of blocks) {
    const hit = [top, ...top.querySelectorAll(BLOCKS)]
      .reverse() // deepest first: the paragraph of a list item, not the whole list
      .find(el => marker.test((el.textContent ?? '').trim()));
    if (!hit) continue;
    const copy = hit.cloneNode(true) as Element;
    const text = lastText(copy);
    if (text) text.textContent = (text.textContent ?? '').replace(marker, '').trimEnd();
    return sanitizeHtml(hit.tagName === 'LI' ? `<ul>${copy.outerHTML}</ul>` : copy.outerHTML);
  }
  return null;
}

/**
 * The part of the note an embed shows, as safe HTML; null when the heading or the block is not in the note.
 * Without a heading or block it is the whole note. A heading's section runs to the next heading as high or higher.
 */
export function embedHtml(html: string, where: { heading?: string; block?: string }): string | null {
  const blocks = blocksOf(html);
  if (where.block) return blockHtml(blocks, where.block);
  if (!where.heading) return sanitizeHtml(html);
  const headings = blocks.filter(b => HEADING.test(b.tagName));
  const at = findHeadingIndex(headings.map(h => ({ text: h.textContent ?? '' })), where.heading);
  if (at === -1) return null;
  const start = blocks.indexOf(headings[at]);
  const level = levelOf(headings[at]);
  let end = start + 1;
  while (end < blocks.length && !(HEADING.test(blocks[end].tagName) && levelOf(blocks[end]) <= level)) end++;
  return sanitizeHtml(blocks.slice(start, end).map(b => b.outerHTML).join(''));
}

/** Images an embed can show: the ones the app serves from the vault. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
export const isImageTarget = (target: string): boolean => IMAGE_EXT.test(target.trim());

/** `![[photo.png|300]]` or `|300x200`: the width (and height) to show it at, in pixels. */
export function imageSize(alias: string | undefined): { width?: number; height?: number } {
  const size = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec((alias ?? '').trim());
  if (!size) return {};
  return { width: Number(size[1]), ...(size[2] ? { height: Number(size[2]) } : {}) };
}
