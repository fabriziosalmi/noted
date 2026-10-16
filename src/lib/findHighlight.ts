import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface FindMatch { from: number; to: number }

export interface FindState {
  query: string;
  /** Index of the match the find bar is on. */
  current: number;
  matches: FindMatch[];
  decorations: DecorationSet;
}

/** What the find bar sends: a new query, a new current match, or both. */
export type FindMeta = Partial<Pick<FindState, 'query' | 'current'>>;

export const findHighlightKey = new PluginKey<FindState>('findHighlight');

/** Stands for an inline node that is not text (an image, a formula, a line break), so no match runs across it. */
const OBJECT = '￼';

/**
 * Every occurrence of `query`, ignoring case. The text of each block is searched as one string, so a phrase that is
 * partly bold or partly a link is still found.
 */
export function findMatches(doc: ProseMirrorNode, query: string): FindMatch[] {
  const results: FindMatch[] = [];
  if (!query.trim()) return results;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const at: number[] = []; // document position of each character of `text`
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) at.push(start + i);
        text += child.text;
      } else {
        at.push(start);
        text += OBJECT;
      }
    });
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      results.push({ from: at[m.index], to: at[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return results;
}

function decorate(doc: ProseMirrorNode, matches: FindMatch[], current: number): DecorationSet {
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === current ? 'find-match find-match-current' : 'find-match' })));
}

/** Marks every match of the find bar in the note, and the current one more strongly. Follows edits while it is open. */
export const FindHighlight = Extension.create({
  name: 'findHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findHighlightKey,
        state: {
          init: () => ({ query: '', current: 0, matches: [], decorations: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(findHighlightKey) as FindMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            if (!query.trim()) return { query, current: 0, matches: [], decorations: DecorationSet.empty };
            const matches = findMatches(state.doc, query);
            const wanted = meta?.current ?? prev.current;
            const current = matches.length === 0 ? 0 : Math.min(Math.max(wanted, 0), matches.length - 1);
            return { query, current, matches, decorations: decorate(state.doc, matches, current) };
          },
        },
        props: { decorations: state => findHighlightKey.getState(state)?.decorations },
      }),
    ];
  },
});
