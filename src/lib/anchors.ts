// Where a link such as [[Note#Heading]] or [[Note#^block]] lands inside the note it opens. Pure over the editor's
// document, so the rules are tested without a screen.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { findHeadingIndex } from '../../shared/vault/wikilink';
import { extractOutline } from './outline';
import { flashPassage } from './passageHighlight';

/** Position of the heading a link names, or null. */
export function headingPosition(doc: PMNode, heading: string): number | null {
  const outline = extractOutline(doc);
  const at = findHeadingIndex(outline, heading);
  return at === -1 ? null : outline[at].pos;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Position of the block marked `^id` (the id ends its text, or stands alone on a line below it), or null. */
export function blockPosition(doc: PMNode, block: string): number | null {
  const marker = new RegExp(`(?:^|\\s)\\^${escapeRegExp(block)}$`);
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock) {
      if (marker.test(node.textContent.trim())) found = pos;
      return false;
    }
    return true;
  });
  return found;
}

const NON_WORD = /[^\p{L}\p{N}]+/gu;
const plain = (s: string): string => s.toLowerCase().replace(NON_WORD, ' ').trim();

/**
 * Where a passage quoted from a note (a retrieved section: plain text, as the search saw it) is in the open document: the blocks
 * that hold it, found by its first words inside the section under `heading` (a path, "Parent#Child"; none = before the first
 * heading). Blocks, not characters: the quoted text has lost its markup, so exact offsets cannot be recovered; what is returned
 * is the paragraphs and list items the passage runs through. Null when the heading or the passage is not there (the note changed).
 */
export function passageRange(doc: PMNode, anchor: { heading?: string; passage: string }): { from: number; to: number } | null {
  const outline = extractOutline(doc);
  let start = 0;
  let end = doc.content.size;
  if (anchor.heading) {
    const at = findHeadingIndex(outline, anchor.heading);
    if (at === -1) return null;
    const node = doc.nodeAt(outline[at].pos);
    start = outline[at].pos + (node?.nodeSize ?? 0);
    const next = outline.slice(at + 1).find(h => h.level <= outline[at].level);
    end = next ? next.pos : doc.content.size;
  } else if (outline.length > 0) {
    end = outline[0].pos;
  }

  const blocks: { from: number; to: number; text: string; at: number }[] = [];
  let joined = '';
  doc.nodesBetween(start, end, (node, pos) => {
    if (node.type.name === 'heading') return false;
    if (!node.isTextblock) return true;
    const text = plain(node.textContent);
    if (text) {
      blocks.push({ from: pos + 1, to: pos + node.nodeSize - 1, text, at: joined.length });
      joined += `${text} `;
    }
    return false;
  });

  const target = plain(anchor.passage);
  const words = target.split(' ');
  let found = -1;
  for (const n of [8, 4, 2]) {
    const lead = words.slice(0, Math.min(n, words.length)).join(' ');
    if (lead.length < 6) continue;
    found = joined.indexOf(lead);
    if (found !== -1) break;
  }
  if (found === -1) return null;
  const last = Math.min(joined.length - 1, found + target.length - 1);
  const first = blocks.findIndex((_, i) => found < (blocks[i + 1]?.at ?? Infinity));
  const final = blocks.findIndex((_, i) => last < (blocks[i + 1]?.at ?? Infinity));
  if (first === -1 || final === -1) return null;
  return { from: blocks[first].from, to: blocks[Math.max(first, final)].to };
}

/** Where `[[Note#fragment]]` points inside the document: a heading, or `^block`; null when the fragment is not there. */
export function anchorPosition(doc: PMNode, anchor: { heading?: string; block?: string; passage?: string }): number | null {
  if (anchor.block) return blockPosition(doc, anchor.block);
  if (anchor.heading) return headingPosition(doc, anchor.heading);
  return null;
}

/** Put the caret at the place a link names and scroll it into view; false when the note has no such heading or block. */
export function scrollToAnchor(editor: Editor, anchor: { heading?: string; block?: string; passage?: string }): boolean {
  // A passage that was quoted (a citation in the chat): mark it and put the caret at its start; if only the heading is still
  // there, land on the heading as a link would.
  if (anchor.passage) {
    const range = passageRange(editor.state.doc, { heading: anchor.heading, passage: anchor.passage });
    if (range) {
      editor.chain().focus().setTextSelection(range.from).scrollIntoView().run();
      flashPassage(editor, range);
      return true;
    }
    if (!anchor.heading) return false;
  }
  const pos = anchorPosition(editor.state.doc, anchor);
  if (pos === null) return false;
  editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  return true;
}
