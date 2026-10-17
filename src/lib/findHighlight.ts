import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface FindMatch { from: number; to: number }

export interface FindState {
  query: string;
  /** Match upper and lower case as typed. */
  caseSensitive: boolean;
  /** Index of the match the find bar is on. */
  current: number;
  matches: FindMatch[];
  decorations: DecorationSet;
}

/** What the find bar sends: a new query, a new current match, or both. */
export type FindMeta = Partial<Pick<FindState, 'query' | 'current' | 'caseSensitive'>>;

export const findHighlightKey = new PluginKey<FindState>('findHighlight');

/** Stands for an inline node that is not text (an image, a formula, a line break), so no match runs across it. */
const OBJECT = '￼';

/**
 * Every occurrence of `query`, ignoring case unless `caseSensitive`. The text of each block is searched as one string,
 * so a phrase that is partly bold or partly a link is still found.
 */
export function findMatches(doc: ProseMirrorNode, query: string, caseSensitive = false): FindMatch[] {
  const results: FindMatch[] = [];
  if (!query.trim()) return results;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
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
          init: () => ({ query: '', caseSensitive: false, current: 0, matches: [], decorations: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(findHighlightKey) as FindMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            if (!query.trim()) return { query, caseSensitive, current: 0, matches: [], decorations: DecorationSet.empty };
            const matches = findMatches(state.doc, query, caseSensitive);
            const wanted = meta?.current ?? prev.current;
            const current = matches.length === 0 ? 0 : Math.min(Math.max(wanted, 0), matches.length - 1);
            return { query, caseSensitive, current, matches, decorations: decorate(state.doc, matches, current) };
          },
        },
        props: { decorations: state => findHighlightKey.getState(state)?.decorations },
      }),
    ];
  },
});

/**
 * Replaces the current match (`all: false`) or every match, and returns how many were replaced. Each replaced text
 * keeps the formatting it had at its start. Replacing all is one step to undo.
 */
export function replaceMatches(view: EditorView, replacement: string, all: boolean): number {
  const state = findHighlightKey.getState(view.state);
  if (!state || state.matches.length === 0) return 0;
  const targets = all ? state.matches : [state.matches[state.current]];
  let tr = view.state.tr;
  for (const m of [...targets].sort((a, b) => b.from - a.from)) tr = tr.insertText(replacement, m.from, m.to); // from the end: earlier positions stay valid
  view.dispatch(tr);
  return targets.length;
}
