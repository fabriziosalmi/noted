import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (noteName: string) => ReturnType;
    };
  }
}

export const WikilinkMark = Mark.create({
  name: 'wikilink',
  priority: 1000,
  keepOnSplit: false,
  inclusive: false,

  addAttributes() {
    return {
      target: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const target = HTMLAttributes.target as string;
    // role/aria-label expose the span as a link to assistive tech; activation
    // is via click or Mod+Enter on the caret (see NoteEditor). No tabindex —
    // focusable inline nodes disrupt caret movement inside contentEditable.
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-wikilink': target,
      class: 'wikilink',
      role: 'link',
      title: `Open note: ${target}`,
      'aria-label': `Open note: ${target}`,
    }), 0];
  },

  addCommands() {
    return {
      insertWikilink: (noteName: string) => ({ chain }) => {
        return chain()
          .insertContent({
            type: 'text',
            marks: [{ type: this.name, attrs: { target: noteName } }],
            text: `[[${noteName}]]`,
          })
          .insertContent({ type: 'text', text: ' ' })
          .run();
      },
    };
  },
});

// Plugin that decorates raw [[text]] syntax not yet converted to marks
const wikilinkPluginKey = new PluginKey('wikilinkSyntax');

export function createWikilinkHighlightPlugin() {
  return new Plugin({
    key: wikilinkPluginKey,
    props: {
      decorations(state) {
        const { doc } = state;
        const decorations: Decoration[] = [];
        const regex = /\[\[([^\]]+)\]\]/g;
        doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return;
          let m;
          while ((m = regex.exec(node.text)) !== null) {
            decorations.push(
              Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                class: 'wikilink-raw',
              })
            );
          }
        });
        return DecorationSet.create(doc, decorations);
      },
    },
  });
}

// Parse all [[target]] from HTML/text content
export function extractWikilinks(text: string): string[] {
  const matches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)];
  return [...new Set(matches.map(m => m[1].trim()))];
}
