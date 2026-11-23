// Listing a note's headings and moving the caret to one. Takes the editor, so it is tested without a screen.
import type { Editor } from '@tiptap/core';

export interface HeadingItem {
  /** Heading depth, 1 to 6. */
  level: number;
  text: string;
  /** Position of the heading node in the document. */
  pos: number;
}

/** The note's headings, in document order. */
export function extractHeadings(editor: Editor): HeadingItem[] {
  const items: HeadingItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') items.push({ level: Number(node.attrs.level), text: node.textContent, pos });
  });
  return items;
}

/** Puts the caret at the start of the heading's text and scrolls it into view. */
export function jumpToHeading(editor: Editor, heading: HeadingItem): void {
  editor.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run();
}
