import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { documentExtensions } from '../../shared/markdown/schema';
import { extractHeadings, jumpToHeading } from './headingJump';

const editors: Editor[] = [];
const makeEditor = (content: string): Editor => {
  const editor = new Editor({ extensions: documentExtensions(), content });
  editors.push(editor);
  return editor;
};
afterEach(() => { for (const e of editors.splice(0)) e.destroy(); });

const HTML = '<h1>Title</h1><p>intro</p><h2>Part one</h2><p>text</p><h3>Detail</h3>';

describe('extractHeadings', () => {
  it('returns nothing for a document without headings', () => {
    expect(extractHeadings(makeEditor('<p>just text</p>'))).toEqual([]);
  });

  it('returns every heading, in order, with its level and text', () => {
    const items = extractHeadings(makeEditor(HTML));
    expect(items.map((h) => [h.level, h.text])).toEqual([
      [1, 'Title'],
      [2, 'Part one'],
      [3, 'Detail'],
    ]);
    expect(items[0].pos).toBe(0);
    expect(items[1].pos).toBeGreaterThan(items[0].pos);
    expect(items[2].pos).toBeGreaterThan(items[1].pos);
  });
});

describe('jumpToHeading', () => {
  it('puts the caret inside the chosen heading', () => {
    const editor = makeEditor(HTML);
    const [, second] = extractHeadings(editor);
    jumpToHeading(editor, second);
    expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe('Part one');
  });

  it('reaches a heading at the very start of the document', () => {
    const editor = makeEditor(HTML);
    const [first, , third] = extractHeadings(editor);
    jumpToHeading(editor, third);
    jumpToHeading(editor, first);
    expect(editor.state.selection.from).toBe(1);
  });
});
