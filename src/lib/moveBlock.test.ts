import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { moveCurrentBlock, MoveBlockExtension } from './moveBlock';

let editor: Editor | null = null;

function make(html: string): Editor {
  editor = new Editor({ extensions: [StarterKit, MoveBlockExtension], content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('moveCurrentBlock', () => {
  it('moves a paragraph down and keeps the cursor inside it', () => {
    const ed = make('<p>one</p><p>two</p>');
    ed.commands.setTextSelection(3);
    expect(moveCurrentBlock(ed, 'down')).toBe(true);
    expect(ed.getHTML()).toBe('<p>two</p><p>one</p>');
    expect(ed.state.selection.from).toBe(8);
    expect(ed.state.selection.$from.parent.textContent).toBe('one');
  });

  it('moves a paragraph up and keeps the cursor inside it', () => {
    const ed = make('<p>one</p><p>two</p>');
    ed.commands.setTextSelection(8);
    expect(moveCurrentBlock(ed, 'up')).toBe(true);
    expect(ed.getHTML()).toBe('<p>two</p><p>one</p>');
    expect(ed.state.selection.from).toBe(3);
    expect(ed.state.selection.$from.parent.textContent).toBe('two');
  });

  it('returns false at the top and bottom edges', () => {
    const ed = make('<p>one</p><p>two</p>');
    ed.commands.setTextSelection(2);
    expect(moveCurrentBlock(ed, 'up')).toBe(false);
    ed.commands.setTextSelection(7);
    expect(moveCurrentBlock(ed, 'down')).toBe(false);
    expect(ed.getHTML()).toBe('<p>one</p><p>two</p>');
  });

  it('moves a list item up inside its list', () => {
    const ed = make('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    ed.commands.setTextSelection(10);
    expect(moveCurrentBlock(ed, 'up')).toBe(true);
    expect(ed.getHTML().startsWith('<ul><li><p>b</p></li><li><p>a</p></li></ul>')).toBe(true);
    expect(ed.state.selection.$from.parent.textContent).toBe('b');
  });

  it('moves a list item down inside its list', () => {
    const ed = make('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    ed.commands.setTextSelection(3);
    expect(moveCurrentBlock(ed, 'down')).toBe(true);
    expect(ed.getHTML().startsWith('<ul><li><p>b</p></li><li><p>a</p></li></ul>')).toBe(true);
    expect(ed.state.selection.$from.parent.textContent).toBe('a');
  });

  it('does not move a list item out of its list', () => {
    const ed = make('<p>x</p><ul><li><p>a</p></li></ul>');
    ed.commands.setTextSelection(5);
    expect(moveCurrentBlock(ed, 'up')).toBe(false);
    expect(ed.getHTML().startsWith('<p>x</p><ul><li><p>a</p></li></ul>')).toBe(true);
  });

  it('returns false when the selection is not inside a textblock', () => {
    const ed = make('<p>one</p><p>two</p>');
    ed.commands.selectAll();
    expect(moveCurrentBlock(ed, 'down')).toBe(false);
    expect(ed.getHTML()).toBe('<p>one</p><p>two</p>');
  });
});

describe('MoveBlockExtension', () => {
  it('binds Alt-ArrowUp and Alt-ArrowDown to block moves', () => {
    const ed = make('<p>one</p><p>two</p>');
    const shortcuts = ed.extensionManager.extensions
      .find((e) => e.name === 'moveBlock')!
      .config.addKeyboardShortcuts!.call({ editor: ed } as never) as Record<string, () => boolean>;
    expect(Object.keys(shortcuts)).toEqual(['Alt-ArrowUp', 'Alt-ArrowDown']);
    ed.commands.setTextSelection(2);
    expect(shortcuts['Alt-ArrowDown']()).toBe(true);
    expect(ed.getHTML()).toBe('<p>two</p><p>one</p>');
    expect(shortcuts['Alt-ArrowUp']()).toBe(true);
    expect(ed.getHTML()).toBe('<p>one</p><p>two</p>');
  });
});
