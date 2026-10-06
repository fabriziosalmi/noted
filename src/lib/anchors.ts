// Where a link such as [[Note#Heading]] or [[Note#^block]] lands inside the note it opens. Pure over the editor's
// document, so the rules are tested without a screen.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { findHeadingIndex } from '../../shared/vault/wikilink';
import { extractOutline } from './outline';

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

/** Where `[[Note#fragment]]` points inside the document: a heading, or `^block`; null when the fragment is not there. */
export function anchorPosition(doc: PMNode, anchor: { heading?: string; block?: string }): number | null {
  if (anchor.block) return blockPosition(doc, anchor.block);
  if (anchor.heading) return headingPosition(doc, anchor.heading);
  return null;
}

/** Put the caret at the place a link names and scroll it into view; false when the note has no such heading or block. */
export function scrollToAnchor(editor: Editor, anchor: { heading?: string; block?: string }): boolean {
  const pos = anchorPosition(editor.state.doc, anchor);
  if (pos === null) return false;
  editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  return true;
}
