import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { documentExtensions } from '../../shared/markdown/schema';
import { toggleWrapCallout } from './calloutWrap';

let editor: Editor | null = null;

function make(html: string): Editor {
  editor = new Editor({ extensions: documentExtensions(), content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('toggleWrapCallout', () => {
  it('wraps a paragraph in a callout of the given kind', () => {
    const ed = make('<p>one</p><p>two</p>');
    ed.commands.setTextSelection(2);
    expect(toggleWrapCallout(ed, 'tip')).toEqual({ action: 'wrapped' });
    expect(ed.state.doc.child(0).type.name).toBe('callout');
    expect(ed.state.doc.child(0).attrs.kind).toBe('tip');
    expect(ed.state.doc.child(1).type.name).toBe('paragraph');
  });

  it('switches the kind of an existing callout', () => {
    const ed = make('<p>one</p>');
    ed.commands.setTextSelection(2);
    toggleWrapCallout(ed, 'tip');
    expect(toggleWrapCallout(ed, 'warning')).toEqual({ action: 'switched' });
    expect(ed.state.doc.child(0).attrs.kind).toBe('warning');
  });

  it('lifts the block out when the kind is the same', () => {
    const ed = make('<p>one</p>');
    ed.commands.setTextSelection(2);
    toggleWrapCallout(ed, 'tip');
    expect(toggleWrapCallout(ed, 'TIP')).toEqual({ action: 'lifted' });
    expect(ed.state.doc.child(0).type.name).toBe('paragraph');
    expect(ed.state.doc.textContent).toBe('one');
  });
});
