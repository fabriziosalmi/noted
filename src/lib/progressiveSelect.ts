import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { findWordRange } from './wordFormat';

type Range = { from: number; to: number };

const LEAF_PLACEHOLDER = '￼';
const SENTENCE = /[^.!?]+[.!?]*/g;

function findSentenceRange(doc: ProseMirrorNode, selection: Range): Range | null {
  const $from = doc.resolve(selection.from);
  const block = $from.parent;
  if (!block.isTextblock || selection.to > $from.end()) return null;

  const text = block.textBetween(0, block.content.size, undefined, LEAF_PLACEHOLDER);
  const blockStart = $from.start();
  for (const match of text.matchAll(SENTENCE)) {
    const raw = match[0];
    const start = match.index + (raw.length - raw.trimStart().length);
    const end = match.index + raw.trimEnd().length;
    if (start >= end) continue;
    const range = { from: blockStart + start, to: blockStart + end };
    if (strictlyContains(range, selection)) return range;
  }
  return null;
}

function findBlockRange(doc: ProseMirrorNode, selection: Range): Range | null {
  const $from = doc.resolve(selection.from);
  if (!$from.parent.isTextblock || selection.to > $from.end()) return null;
  const range = { from: $from.start(), to: $from.end() };
  return range.from < range.to ? range : null;
}

function strictlyContains(outer: Range, inner: Range): boolean {
  return outer.from <= inner.from && outer.to >= inner.to && outer.to - outer.from > inner.to - inner.from;
}

/** Next larger range (word, sentence, textblock) strictly containing `selection`, or null when none does. */
export function nextProgressiveRange(doc: ProseMirrorNode, selection: Range): Range | null {
  if (selection.from < 0 || selection.to > doc.content.size || selection.from > selection.to) return null;
  const word = findWordRange(doc, selection.from);
  if (word && strictlyContains(word, selection)) return word;
  const sentence = findSentenceRange(doc, selection);
  if (sentence) return sentence;
  const block = findBlockRange(doc, selection);
  return block && strictlyContains(block, selection) ? block : null;
}

/** Expands the selection to the next word, sentence or textblock; false when it cannot grow. */
export function expandSelection(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  const range = nextProgressiveRange(editor.state.doc, { from, to });
  if (!range) return false;
  return editor.commands.setTextSelection(range);
}

export const ProgressiveSelectExtension = Extension.create({
  name: 'progressiveSelect',
  addKeyboardShortcuts() {
    return {
      F8: () => expandSelection(this.editor),
    };
  },
});
