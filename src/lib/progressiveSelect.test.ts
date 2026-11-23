import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expandSelection, nextProgressiveRange, ProgressiveSelectExtension } from './progressiveSelect';

let editor: Editor | null = null;

function make(html: string): Editor {
  editor = new Editor({ extensions: [StarterKit, ProgressiveSelectExtension], content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

// "Hello big world. Second one!" -> paragraph text starts at position 1.
const HTML = '<p>Hello big world. Second one!</p>';

describe('nextProgressiveRange', () => {
  it('progresses word -> sentence -> block -> null', () => {
    const { doc } = make(HTML).state;
    const word = nextProgressiveRange(doc, { from: 8, to: 8 });
    expect(word).toEqual({ from: 7, to: 10 });
    const sentence = nextProgressiveRange(doc, word!);
    expect(sentence).toEqual({ from: 1, to: 17 });
    const block = nextProgressiveRange(doc, sentence!);
    expect(block).toEqual({ from: 1, to: 29 });
    expect(nextProgressiveRange(doc, block!)).toBeNull();
  });

  it('trims whitespace around sentences', () => {
    const { doc } = make(HTML).state;
    expect(nextProgressiveRange(doc, { from: 19, to: 25 })).toEqual({ from: 18, to: 29 });
  });

  it('skips the word step when the caret is not on a word', () => {
    const { doc } = make('<p>a&nbsp;&nbsp;b.</p>').state;
    expect(nextProgressiveRange(doc, { from: 3, to: 3 })).toEqual({ from: 1, to: 6 });
  });

  it('returns null for empty blocks and selections spanning blocks', () => {
    const { doc } = make('<p></p><p>one</p><p>two</p>').state;
    expect(nextProgressiveRange(doc, { from: 1, to: 1 })).toBeNull();
    expect(nextProgressiveRange(doc, { from: 3, to: 7 })).toBeNull();
  });
});

describe('ProgressiveSelectExtension', () => {
  it('expandSelection grows the editor selection and stops at the block', () => {
    const ed = make(HTML);
    ed.commands.setTextSelection(8);
    expect(expandSelection(ed)).toBe(true);
    expect(ed.state.selection.from).toBe(7);
    expect(ed.state.selection.to).toBe(10);
    expect(expandSelection(ed)).toBe(true);
    expect(expandSelection(ed)).toBe(true);
    expect(ed.state.selection.from).toBe(1);
    expect(ed.state.selection.to).toBe(29);
    expect(expandSelection(ed)).toBe(false);
  });

  it('binds F8', () => {
    const ed = make(HTML);
    const shortcuts = ed.extensionManager.extensions
      .find((e) => e.name === 'progressiveSelect')!
      .config.addKeyboardShortcuts!.call({ editor: ed } as never) as Record<string, () => boolean>;
    expect(Object.keys(shortcuts)).toEqual(['F8']);
    ed.commands.setTextSelection(8);
    expect(shortcuts.F8()).toBe(true);
    expect(ed.state.selection.to).toBe(10);
  });
});
