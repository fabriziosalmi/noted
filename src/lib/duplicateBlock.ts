import { Extension, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

/** Duplicates the textblock around the cursor (or its list item) right after itself and moves the selection into the copy. */
export function duplicateCurrentBlock(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;

  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
  if (depth === 0) return false;
  if (depth > 1 && $from.node(depth - 1).type.name === 'listItem') depth -= 1;

  const node = $from.node(depth);
  const insertPos = $from.after(depth);
  const tr = state.tr.insert(insertPos, node.copy(node.content));
  const cursor = Math.min($from.pos + node.nodeSize, tr.doc.content.size);
  editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(cursor))).scrollIntoView());
  return true;
}

export const DuplicateBlockExtension = Extension.create({
  name: 'duplicateBlock',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-d': () => duplicateCurrentBlock(this.editor),
    };
  },
});
