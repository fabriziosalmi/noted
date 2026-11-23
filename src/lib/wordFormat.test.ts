import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { findWordRange, toggleMarkAtWordOrSelection, WordFormatExtension, type WordMarkName } from './wordFormat';

let editor: Editor | null = null;

function make(html: string): Editor {
  editor = new Editor({ extensions: [StarterKit, WordFormatExtension], content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

// The paragraph's text starts at document position 1.
describe('findWordRange', () => {
  it('finds the word from its interior and both boundaries', () => {
    const { doc } = make('<p>hello world</p>').state;
    expect(findWordRange(doc, 3)).toEqual({ from: 1, to: 6 });
    expect(findWordRange(doc, 1)).toEqual({ from: 1, to: 6 });
    expect(findWordRange(doc, 6)).toEqual({ from: 1, to: 6 });
    expect(findWordRange(doc, 7)).toEqual({ from: 7, to: 12 });
    expect(findWordRange(doc, 12)).toEqual({ from: 7, to: 12 });
  });

  it('returns null between whitespace, in empty blocks and out of range', () => {
    const { doc } = make('<p>a&nbsp;&nbsp;b</p><p></p>').state;
    expect(findWordRange(doc, 3)).toBeNull();
    expect(findWordRange(doc, 7)).toBeNull();
    expect(findWordRange(doc, 99)).toBeNull();
  });

  it('includes underscores, hyphens, digits and Unicode letters', () => {
    const { doc } = make('<p>snake_case-x9 città</p>').state;
    expect(findWordRange(doc, 4)).toEqual({ from: 1, to: 14 });
    expect(findWordRange(doc, 18)).toEqual({ from: 15, to: 20 });
  });

  it('stops at punctuation and does not cross blocks', () => {
    const { doc } = make('<p>foo.bar</p><p>baz</p>').state;
    expect(findWordRange(doc, 2)).toEqual({ from: 1, to: 4 });
    expect(findWordRange(doc, 7)).toEqual({ from: 5, to: 8 });
    expect(findWordRange(doc, 11)).toEqual({ from: 10, to: 13 });
  });
});

describe('toggleMarkAtWordOrSelection', () => {
  const marks: WordMarkName[] = ['bold', 'italic', 'code'];

  it.each(marks)('toggles %s on and off, preserving the cursor', (mark) => {
    const ed = make('<p>hello world</p>');
    ed.commands.setTextSelection(3);

    expect(toggleMarkAtWordOrSelection(ed, mark)).toBe(true);
    expect(ed.isActive(mark)).toBe(true);
    expect(ed.state.doc.rangeHasMark(1, 6, ed.schema.marks[mark])).toBe(true);
    expect(ed.state.doc.rangeHasMark(7, 12, ed.schema.marks[mark])).toBe(false);
    expect(ed.state.selection.empty).toBe(true);
    expect(ed.state.selection.from).toBe(3);

    expect(toggleMarkAtWordOrSelection(ed, mark)).toBe(true);
    expect(ed.state.doc.rangeHasMark(1, 6, ed.schema.marks[mark])).toBe(false);
    expect(ed.state.selection.from).toBe(3);
  });

  it('returns false when no word is at the cursor', () => {
    const ed = make('<p>a&nbsp;&nbsp;b</p>');
    ed.commands.setTextSelection(3);
    expect(toggleMarkAtWordOrSelection(ed, 'bold')).toBe(false);
    expect(ed.getHTML()).toBe('<p>a&nbsp;&nbsp;b</p>');
  });

  it('returns false for a non-empty selection and leaves it untouched', () => {
    const ed = make('<p>hello world</p>');
    ed.commands.setTextSelection({ from: 2, to: 4 });
    expect(toggleMarkAtWordOrSelection(ed, 'bold')).toBe(false);
    expect(ed.state.selection.from).toBe(2);
    expect(ed.state.selection.to).toBe(4);
    expect(ed.getHTML()).toBe('<p>hello world</p>');
  });
});

describe('WordFormatExtension', () => {
  it('binds Mod-b, Mod-i and Mod-` to the word toggles', () => {
    const ed = make('<p>hello</p>');
    const shortcuts = ed.extensionManager.extensions
      .find((e) => e.name === 'wordFormat')!
      .config.addKeyboardShortcuts!.call({ editor: ed } as never) as Record<string, () => boolean>;
    expect(Object.keys(shortcuts).sort()).toEqual(['Mod-`', 'Mod-b', 'Mod-i']);

    ed.commands.setTextSelection(3);
    expect(shortcuts['Mod-b']()).toBe(true);
    expect(ed.getHTML()).toBe('<p><strong>hello</strong></p>');
  });
});
