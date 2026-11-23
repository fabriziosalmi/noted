import { Extension, type Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/** Swaps the textblock around the cursor (or its list item) with the previous/next sibling and keeps the cursor in the moved block. */
export function moveCurrentBlock(editor: Editor, direction: 'up' | 'down'): boolean {
  const { state } = editor;
  const { $from } = state.selection;

  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
  if (depth === 0) return false;
  if (depth > 1 && $from.node(depth - 1).type.name === 'listItem') depth -= 1;

  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const siblingIndex = direction === 'up' ? index - 1 : index + 1;
  if (siblingIndex < 0 || siblingIndex >= parent.childCount) return false;

  const node = $from.node(depth);
  const sibling = parent.child(siblingIndex);
  const start = $from.before(depth);
  const end = $from.after(depth);
  const offset = $from.pos - start;

  const tr =
    direction === 'up'
      ? state.tr.replaceWith(start - sibling.nodeSize, end, Fragment.from([node, sibling]))
      : state.tr.replaceWith(start, end + sibling.nodeSize, Fragment.from([sibling, node]));
  const nodeStart = direction === 'up' ? start - sibling.nodeSize : start + sibling.nodeSize;
  editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(nodeStart + offset))).scrollIntoView());
  return true;
}

export const MoveBlockExtension = Extension.create({
  name: 'moveBlock',
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveCurrentBlock(this.editor, 'up'),
      'Alt-ArrowDown': () => moveCurrentBlock(this.editor, 'down'),
    };
  },
});
