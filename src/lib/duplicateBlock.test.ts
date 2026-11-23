import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { duplicateCurrentBlock, DuplicateBlockExtension } from './duplicateBlock';

let editor: Editor | null = null;

function make(html: string): Editor {
  editor = new Editor({ extensions: [StarterKit, DuplicateBlockExtension], content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('duplicateCurrentBlock', () => {
  it('duplicates a paragraph after itself and moves the cursor into the copy', () => {
    const ed = make('<p>one</p><p>two</p>');
    ed.commands.setTextSelection(3);
    expect(duplicateCurrentBlock(ed)).toBe(true);
    expect(ed.getHTML()).toBe('<p>one</p><p>one</p><p>two</p>');
    expect(ed.state.selection.from).toBe(8);
    expect(ed.state.doc.resolve(ed.state.selection.from).index(0)).toBe(1);
  });

  it('keeps the heading level', () => {
    const ed = make('<h2>Title</h2>');
    ed.commands.setTextSelection(2);
    expect(duplicateCurrentBlock(ed)).toBe(true);
    expect(ed.getHTML().startsWith('<h2>Title</h2><h2>Title</h2>')).toBe(true);
  });

  it('duplicates a bullet item inside the same list', () => {
    const ed = make('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    ed.commands.setTextSelection(3);
    expect(duplicateCurrentBlock(ed)).toBe(true);
    expect(ed.getHTML().startsWith('<ul><li><p>a</p></li><li><p>a</p></li><li><p>b</p></li></ul>')).toBe(true);
    expect(ed.state.doc.resolve(ed.state.selection.from).parent.textContent).toBe('a');
    expect(ed.state.doc.resolve(ed.state.selection.from).index(1)).toBe(1);
  });

  it('returns false when the selection is not inside a textblock', () => {
    const ed = make('<p>one</p>');
    ed.commands.selectAll();
    expect(duplicateCurrentBlock(ed)).toBe(false);
    expect(ed.getHTML()).toBe('<p>one</p>');
  });
});

describe('DuplicateBlockExtension', () => {
  it('binds Mod-Shift-d to the duplication', () => {
    const ed = make('<p>hi</p>');
    const shortcuts = ed.extensionManager.extensions
      .find((e) => e.name === 'duplicateBlock')!
      .config.addKeyboardShortcuts!.call({ editor: ed } as never) as Record<string, () => boolean>;
    expect(Object.keys(shortcuts)).toEqual(['Mod-Shift-d']);
    ed.commands.setTextSelection(2);
    expect(shortcuts['Mod-Shift-d']()).toBe(true);
    expect(ed.getHTML()).toBe('<p>hi</p><p>hi</p>');
  });
});
