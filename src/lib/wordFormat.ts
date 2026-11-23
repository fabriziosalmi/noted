import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export type WordMarkName = 'bold' | 'italic' | 'code';

const WORD_CHAR = /^[\p{L}\p{N}_-]$/u;
const LEAF_PLACEHOLDER = '￼';

/** Range of the word (letters, digits, `_`, `-`) touching `pos` inside its textblock, or null when there is none. */
export function findWordRange(doc: ProseMirrorNode, pos: number): { from: number; to: number } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock) return null;

  const text = block.textBetween(0, block.content.size, undefined, LEAF_PLACEHOLDER);
  const offset = $pos.parentOffset;
  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  if (start === end) return null;

  const blockStart = $pos.start();
  return { from: blockStart + start, to: blockStart + end };
}

/** Toggles `mark` on the word around a collapsed cursor, keeping the cursor where it was. */
export function toggleMarkAtWordOrSelection(editor: Editor, mark: WordMarkName): boolean {
  const { selection, doc } = editor.state;
  if (!selection.empty) return false;
  const range = findWordRange(doc, selection.from);
  if (!range) return false;
  return editor
    .chain()
    .setTextSelection(range)
    .toggleMark(mark)
    .setTextSelection(selection.from)
    .run();
}

export const WordFormatExtension = Extension.create({
  name: 'wordFormat',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => toggleMarkAtWordOrSelection(this.editor, 'bold'),
      'Mod-i': () => toggleMarkAtWordOrSelection(this.editor, 'italic'),
      'Mod-`': () => toggleMarkAtWordOrSelection(this.editor, 'code'),
    };
  },
});
