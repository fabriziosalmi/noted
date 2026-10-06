import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { documentExtensions } from '../../shared/markdown/schema';
import { OutlinePanel } from './OutlinePanel';

const editors: Editor[] = [];
const makeEditor = (content: string): Editor => {
  const editor = new Editor({ extensions: documentExtensions(), content });
  editors.push(editor);
  return editor;
};
afterEach(() => { for (const e of editors.splice(0)) e.destroy(); });

const HTML = '<h1>Title</h1><p>intro</p><h2>Part one</h2><p>text</p><h3>Detail</h3><h2>Part two</h2>';

describe('OutlinePanel', () => {
  it('lists the headings, indented by depth', () => {
    render(<OutlinePanel editor={makeEditor(HTML)} />);
    const nav = screen.getByTestId('outline');
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map(b => b.textContent)).toEqual(['Title', 'Part one', 'Detail', 'Part two']);
    const pad = (b: HTMLElement) => (b.closest('li') as HTMLElement).style.paddingLeft;
    expect(buttons.map(pad)).toEqual(['0px', '12px', '24px', '12px']);
  });

  it('says so when there is nothing to list, or no editor yet', () => {
    const { rerender } = render(<OutlinePanel editor={makeEditor('<p>no headings</p>')} />);
    expect(screen.getByText('This note has no headings yet.')).toBeInTheDocument();
    rerender(<OutlinePanel editor={null} />);
    expect(screen.getByText('This note has no headings yet.')).toBeInTheDocument();
  });

  it('a click puts the caret at that heading, and that heading is the current one', async () => {
    const editor = makeEditor(HTML);
    render(<OutlinePanel editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe('Detail');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detail' }).getAttribute('aria-current')).toBe('location'));
    expect(screen.getByRole('button', { name: 'Part one' }).getAttribute('aria-current')).toBeNull();
  });

  it('follows the caret through the note', async () => {
    const editor = makeEditor(HTML);
    render(<OutlinePanel editor={editor} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Title' }).getAttribute('aria-current')).toBe('location'));
    act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); }); // the end: under "Part two"
    await waitFor(() => expect(screen.getByRole('button', { name: 'Part two' }).getAttribute('aria-current')).toBe('location'));
  });

  it('keeps up with what is typed: a new heading appears, a renamed one changes', async () => {
    const editor = makeEditor(HTML);
    render(<OutlinePanel editor={editor} />);
    act(() => { editor.chain().focus('end').insertContent('<h2>Part three</h2>').run(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Part three' })).toBeInTheDocument());
    act(() => { editor.commands.setContent('<h1>Another title</h1>'); });
    await waitFor(() => expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Another title']));
  });

  it('stops listening to an editor it no longer shows', () => {
    const editor = makeEditor(HTML);
    const { unmount } = render(<OutlinePanel editor={editor} />);
    unmount();
    expect(() => act(() => { editor.commands.setContent('<h1>x</h1>'); })).not.toThrow();
  });
});
