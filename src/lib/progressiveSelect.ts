import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { findWordRange } from './wordFormat';

interface Range { from: number; to: number }

const LEAF_PLACEHOLDER = '￼';
const SENTENCE = /[^.!?]+[.!?]*/g;

/** Trimmed sentence range (bounded by `[.!?]+`) containing `pos`, or null when `pos` is outside a non-empty textblock. */
export function findSentenceRange(doc: ProseMirrorNode, pos: number): Range | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock) return null;

  const text = block.textBetween(0, block.content.size, undefined, LEAF_PLACEHOLDER);
  const offset = $pos.parentOffset;
  const blockStart = $pos.start();
  for (const match of text.matchAll(SENTENCE)) {
    const raw = match[0];
    const start = match.index + (raw.length - raw.trimStart().length);
    const end = match.index + raw.trimEnd().length;
    if (start >= end || offset < start || offset >= end) continue;
    return { from: blockStart + start, to: blockStart + end };
  }
  return null;
}

/** Whole non-empty textblock containing `pos`, or null for empty blocks and non-textblock positions. */
export function findBlockRange(doc: ProseMirrorNode, pos: number): Range | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const from = $pos.start();
  const to = $pos.end();
  return from < to ? { from, to } : null;
}

/** First of word, sentence, textblock that strictly contains `{ from, to }`, or null when none is larger. */
export function nextProgressiveSelection(doc: ProseMirrorNode, from: number, to: number): Range | null {
  if (from < 0 || to > doc.content.size || from > to) return null;
  const candidates = [findWordRange(doc, from), findSentenceRange(doc, from), findBlockRange(doc, from)];
  for (const range of candidates) {
    if (!range) continue;
    const strictlyContains = range.from <= from && range.to >= to && (range.from < from || range.to > to);
    if (strictlyContains) return range;
  }
  return null;
}

/** F8 expands the selection to the next word, sentence or textblock; false when it cannot grow. */
export const ProgressiveSelectExtension = Extension.create({
  name: 'progressiveSelect',
  addKeyboardShortcuts() {
    return {
      F8: () => {
        const { from, to } = this.editor.state.selection;
        const range = nextProgressiveSelection(this.editor.state.doc, from, to);
        return range ? this.editor.commands.setTextSelection(range) : false;
      },
    };
  },
});
