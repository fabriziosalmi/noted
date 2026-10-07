import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const passageHighlightKey = new PluginKey<DecorationSet>('passageHighlight');

const CLEAR = 'clear';

/** A passage shown with a marker (not selected: typing must not replace it). It follows edits, and `flashPassage` takes it away again. */
export const PassageHighlight = Extension.create({
  name: 'passageHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: passageHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(passageHighlightKey) as { from: number; to: number } | typeof CLEAR | undefined;
            if (meta === CLEAR) return DecorationSet.empty;
            if (meta) return DecorationSet.create(tr.doc, [Decoration.inline(meta.from, meta.to, { class: 'cited-passage' })]);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: state => passageHighlightKey.getState(state) },
      }),
    ];
  },
});

const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
export const PASSAGE_FLASH_MS = 6000;

/** Marks a range of the document for a few seconds, and scrolls to it. */
export function flashPassage(editor: Editor, range: { from: number; to: number }, ms = PASSAGE_FLASH_MS): void {
  const previous = timers.get(editor);
  if (previous) clearTimeout(previous);
  editor.view.dispatch(editor.state.tr.setMeta(passageHighlightKey, range));
  timers.set(editor, setTimeout(() => {
    timers.delete(editor);
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(passageHighlightKey, CLEAR));
  }, ms));
}
