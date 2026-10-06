import { mergeAttributes } from '@tiptap/core';
import { WikilinkMark as BaseWikilinkMark } from '../../shared/markdown/schema';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { translate } from './i18n';
import { useStore } from '../store/useStore';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (noteName: string, fragment?: string) => ReturnType;
    };
  }
}

// The mark itself (name, attributes, how it parses) is defined once, with the rest of the document model, in
// shared/markdown/schema.ts; this adds what only the editor needs: the accessible label and the commands.
export const WikilinkMark = BaseWikilinkMark.extend({
  renderHTML({ HTMLAttributes }) {
    const target = HTMLAttributes.target as string;
    const openLabel = translate('openNoteAria', useStore.getState().settings.language).replace('{target}', target);
    // role/aria-label expose the span as a link to assistive tech; activation
    // is via click or Mod+Enter on the caret (see NoteEditor). No tabindex —
    // focusable inline nodes disrupt caret movement inside contentEditable.
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-wikilink': target,
      class: 'wikilink',
      role: 'link',
      title: openLabel,
      'aria-label': openLabel,
    }), 0];
  },

  addCommands() {
    return {
      // `fragment` is what follows the `#`: a heading's text, or `^id` for a block.
      insertWikilink: (noteName: string, fragment?: string) => ({ chain }) => {
        return chain()
          .insertContent({
            type: 'text',
            marks: [{ type: this.name, attrs: { target: noteName } }],
            text: `[[${noteName}${fragment ? `#${fragment}` : ''}]]`,
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
