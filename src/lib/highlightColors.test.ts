// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { SEMANTIC_HIGHLIGHTS, toggleSemanticHighlight } from './highlightColors';

function makeEditor() {
  return new Editor({
    extensions: [StarterKit, Highlight.configure({ multicolor: true })],
    content: '<p>hello</p>',
  });
}

describe('SEMANTIC_HIGHLIGHTS', () => {
  it('defines the focus, ok and doubt palette', () => {
    expect(SEMANTIC_HIGHLIGHTS.map((h) => [h.id, h.color])).toEqual([
      ['focus', '#fef08a'],
      ['ok', '#bbf7d0'],
      ['doubt', '#fecaca'],
    ]);
    expect(SEMANTIC_HIGHLIGHTS.every((h) => h.label.length > 0)).toBe(true);
  });
});

describe('toggleSemanticHighlight', () => {
  it('applies, switches and removes a color', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    expect(toggleSemanticHighlight(editor, '#fef08a')).toBe(true);
    expect(editor.isActive('highlight', { color: '#fef08a' })).toBe(true);
    toggleSemanticHighlight(editor, '#fecaca');
    expect(editor.isActive('highlight', { color: '#fecaca' })).toBe(true);
    expect(editor.isActive('highlight', { color: '#fef08a' })).toBe(false);
    toggleSemanticHighlight(editor, '#fecaca');
    expect(editor.isActive('highlight')).toBe(false);
    editor.destroy();
  });
});
