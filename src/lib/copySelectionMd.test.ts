import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { documentExtensions } from '../../shared/markdown/schema';
import { copySelectionAsMarkdown, selectionToMarkdown } from './copySelectionMd';

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: documentExtensions(), content });
  editors.push(editor);
  return editor;
}

function installClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
  vi.restoreAllMocks();
});

describe('selectionToMarkdown', () => {
  it('returns nothing for an empty selection', () => {
    const editor = makeEditor('<p>Not selected</p>');
    expect(editor.state.selection.empty).toBe(true);
    expect(selectionToMarkdown(editor)).toBe('');
  });

  it('writes inline formatting as Markdown', () => {
    const editor = makeEditor('<p>This is <strong>bold</strong> and <em>italic</em>.</p>');
    editor.commands.selectAll();
    expect(selectionToMarkdown(editor)).toBe('This is **bold** and *italic*.');
  });

  it('keeps paragraphs and headings of a multi-block selection in order', () => {
    const editor = makeEditor('<h2>Title</h2><p>First line</p><p>Second line</p>');
    editor.commands.selectAll();
    expect(selectionToMarkdown(editor)).toBe('## Title\n\nFirst line\n\nSecond line');
  });

  it('keeps the block type when the selection starts inside a heading', () => {
    const editor = makeEditor('<h2>Title</h2><p>Body</p>');
    editor.commands.setTextSelection({ from: 3, to: 6 });
    expect(selectionToMarkdown(editor)).toBe('## tle');
  });
});

describe('copySelectionAsMarkdown', () => {
  it('writes the selected Markdown to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    const editor = makeEditor('<h2>Title</h2><p>Body</p>');
    editor.commands.selectAll();

    await expect(copySelectionAsMarkdown(editor)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('## Title\n\nBody');
  });

  it('does not touch the clipboard for an empty selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    const editor = makeEditor('<p>Not selected</p>');

    await expect(copySelectionAsMarkdown(editor)).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports failure when the clipboard rejects the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    installClipboard(writeText);
    const editor = makeEditor('<p>Selected</p>');
    editor.commands.selectAll();

    await expect(copySelectionAsMarkdown(editor)).resolves.toBe(false);
  });
});
