import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SlashCommands } from './SlashCommands';
import { useStore } from '../store/useStore';

vi.mock('../lib/llm', () => ({ askLLM: vi.fn(), AbortedError: class AbortedError extends Error {}, describeLlmError: (e: Error) => `llm: ${e.message}` }));
import { askLLM } from '../lib/llm';

const original = window.electronAPI;
const file = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
const raw: Record<string, string> = {
  'prompts/Haiku.md': '---\nname: Haiku\nscope: note\ndescription: A haiku\n---\nA haiku about: {{note}}\n',
  'prompts/Digest.md': '---\nname: Digest\nscope: any\nmode: append\n---\nDigest of {{selection}}\n',
  'prompts/Formal.md': '---\nname: Formal\nscope: selection\n---\nMake formal: {{selection}}\n',
};
let editor: Editor;

beforeEach(() => {
  vi.mocked(askLLM).mockReset();
  window.electronAPI = { ...original, readNote: vi.fn(async (n: string) => (n in raw ? { success: true, data: raw[n] } : { success: false })) } as unknown as typeof window.electronAPI;
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en', piiMasking: false },
    notes: Object.keys(raw).map(file),
    frontmatterIndex: { 'prompts/Haiku.md': { name: 'Haiku', scope: 'note', description: 'A haiku' }, 'prompts/Digest.md': { name: 'Digest', scope: 'any', mode: 'append' }, 'prompts/Formal.md': { name: 'Formal', scope: 'selection' } },
  });
  editor = new Editor({ extensions: [StarterKit], content: '<p>The autumn note</p>' });
  (editor.view as unknown as { coordsAtPos: () => unknown }).coordsAtPos = () => ({ top: 0, left: 0, bottom: 0, right: 0 });
});
afterEach(() => { editor.destroy(); window.electronAPI = original; });

/** Types "/<q>" at the end of the note. */
const type = (q: string) => act(() => { editor.commands.focus('end'); editor.commands.insertContent(` /${q}`); });

describe('SlashCommands with prompts', () => {
  it('lists the built-in commands, then the prompts of the vault that work without a selection', async () => {
    render(<SlashCommands editor={editor} />);
    type('');
    expect(await screen.findByText('Your prompts')).toBeInTheDocument();
    expect(screen.getByText('Haiku')).toBeInTheDocument();
    expect(screen.getByText('Digest')).toBeInTheDocument();
    expect(screen.queryByText('Formal')).toBeNull(); // it needs a selection: not here
    expect(screen.getByText('A haiku')).toBeInTheDocument();
  });

  it('what is typed after the slash narrows the list, by name or by the file name', async () => {
    render(<SlashCommands editor={editor} />);
    type('hai');
    await screen.findByText('Haiku');
    expect(screen.queryByText('Digest')).toBeNull();
    expect(screen.queryByText('Your prompts')).toBeTruthy();
  });

  it('choosing a prompt removes the /text, fills the prompt with the note, and puts the answer at the caret', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('Leaves fall **softly**');
    render(<SlashCommands editor={editor} />);
    type('hai');
    fireEvent.mouseDown(await screen.findByText('Haiku'));
    await waitFor(() => expect(askLLM).toHaveBeenCalled());
    expect(vi.mocked(askLLM).mock.calls[0][0][1].content.trimEnd()).toBe('A haiku about: The autumn note');
    await waitFor(() => expect(editor.getHTML()).toContain('<strong>softly</strong>'));
    expect(editor.getText()).not.toContain('/hai');
    expect(editor.getText()).toContain('Leaves fall softly');
  });

  it('a prompt marked append puts its answer at the end of the note, after a rule', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('A digest.');
    render(<SlashCommands editor={editor} />);
    type('dig');
    fireEvent.mouseDown(await screen.findByText('Digest'));
    await waitFor(() => expect(editor.getHTML()).toContain('<hr>'));
    expect(editor.getHTML().endsWith('<p>A digest.</p>')).toBe(true);
    // a prompt for "any" text with no selection works on the note
    expect(vi.mocked(askLLM).mock.calls[0][0][1].content.trimEnd()).toBe('Digest of The autumn note');
  });

  it('Enter chooses the highlighted prompt; a model that fails is reported and the note is left alone', async () => {
    vi.mocked(askLLM).mockRejectedValueOnce(new Error('no key'));
    const onAiError = vi.fn();
    render(<SlashCommands editor={editor} onAiError={onAiError} />);
    type('hai');
    await screen.findByText('Haiku');
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(onAiError).toHaveBeenCalledWith('llm: no key'));
    expect(editor.getText().trimEnd()).toBe('The autumn note'); // the /hai text was taken away, nothing was added
  });

  it('with no prompts the menu is the built-in commands alone', async () => {
    useStore.setState({ notes: [], frontmatterIndex: {} });
    render(<SlashCommands editor={editor} />);
    type('');
    await waitFor(() => expect(screen.getByText('AI Actions')).toBeInTheDocument());
    expect(screen.queryByText('Your prompts')).toBeNull();
  });
});
