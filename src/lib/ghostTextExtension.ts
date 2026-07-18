import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const ghostTextKey = new PluginKey<string>('ghostText');

/** Sets ghost text visible in editor. Pass '' to clear. */
export const GhostTextExtension = Extension.create({
  name: 'ghostText',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ghostTextKey,
        state: {
          init: () => '',
          apply(tr, prev) {
            const next = tr.getMeta(ghostTextKey);
            return next !== undefined ? next : prev;
          },
        },
        props: {
          decorations(state) {
            const text = ghostTextKey.getState(state);
            if (!text) return DecorationSet.empty;
            const { from } = state.selection;
            const widget = Decoration.widget(from, () => {
              const span = document.createElement('span');
              span.className = 'ghost-text';
              span.textContent = text;
              span.setAttribute('aria-hidden', 'true');
              return span;
            }, { side: 1 });
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});
