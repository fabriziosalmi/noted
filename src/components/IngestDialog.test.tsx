import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IngestDialog } from './IngestDialog';
import { ConfirmProvider } from './ConfirmProvider';
import { useStore } from '../store/useStore';

vi.mock('../lib/llm', async importOriginal => ({ ...(await importOriginal<object>()), askLLM: vi.fn() }));
vi.mock('../lib/ragSearch', () => ({ retrieveChunks: vi.fn() }));
import { askLLM } from '../lib/llm';
import { retrieveChunks } from '../lib/ragSearch';

const original = window.electronAPI;
const ARTICLE = 'A long enough article about the quarterly planning process and how teams decide what to build next. '.repeat(3);
const chunk = (name: string, headingPath: string[] = []) => ({ name, title: name.replace(/\.md$/, ''), headingPath, text: 't', ord: 0, score: 1, lexicalRank: 1, denseRank: null, coverage: 1, similarity: null });
let ingestFetch: ReturnType<typeof vi.fn>;
let saveNote: ReturnType<typeof vi.fn>;
const openNote = vi.fn();
const notice = vi.fn();

beforeEach(() => {
  vi.mocked(askLLM).mockReset().mockResolvedValue(JSON.stringify({ title: 'Quarterly planning', summary: 'How teams plan.', key_points: ['Decide', 'Build'] }));
  vi.mocked(retrieveChunks).mockReset().mockResolvedValue({ mode: 'lexical', chunks: [chunk('Work/Plan.md', ['Goals']), chunk('Ideas.md')] });
  ingestFetch = vi.fn(async () => ({ success: true, data: { url: 'https://example.com/post', title: 'Planning post', text: ARTICLE, truncated: false } }));
  saveNote = vi.fn(async () => ({ success: true }));
  window.electronAPI = { ...original, ingestFetch, saveNote, createFolder: vi.fn(async () => ({ success: true })), getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }) } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en', llmProvider: 'lmstudio', llmModel: 'qwen3', piiMasking: false, ingestLocalOnly: false }, notes: [], ingestOpen: true });
});
afterEach(() => { window.electronAPI = original; openNote.mockClear(); notice.mockClear(); });

const open = () => render(<ConfirmProvider><IngestDialog onOpenNote={openNote} onNotice={notice} /></ConfirmProvider>);
const prepare = async (url = 'https://example.com/post') => {
  open();
  fireEvent.change(screen.getByLabelText('Web address'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Read and summarise' }));
  return screen.findByTestId('ingest-preview');
};

describe('IngestDialog', () => {
  it('asks for an address or text, and does nothing until there is one', () => {
    open();
    expect(screen.getByRole('button', { name: 'Read and summarise' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Or paste text'), { target: { value: 'some text' } });
    expect(screen.getByRole('button', { name: 'Read and summarise' })).toBeEnabled();
  });

  it('an address turns the text box off (one source at a time)', () => {
    open();
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com' } });
    expect(screen.getByLabelText('Or paste text')).toBeDisabled();
  });

  it('shows the summary and the key points to read, the suggested links one by one, and nothing is written yet', async () => {
    const preview = await prepare();
    expect(preview).toHaveTextContent('How teams plan.');
    expect(preview).toHaveTextContent('Decide');
    expect(screen.getByLabelText('Note title')).toHaveValue('Planning post');
    expect(document.querySelectorAll('[data-change]')).toHaveLength(2);
    expect(screen.getByTestId('review-count')).toHaveTextContent('2 of 2 changes kept');
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('creates the note with the links that were kept, under the title that was typed, and opens it', async () => {
    await prepare();
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'My planning notes' } });
    fireEvent.click(within(document.querySelector('[data-change="0"]') as HTMLElement).getByRole('button', { name: 'Drop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));
    await waitFor(() => expect(openNote).toHaveBeenCalledWith('sources/My planning notes.md'));
    const [name, html] = saveNote.mock.calls[0] as [string, string];
    expect(name).toBe('sources/My planning notes.md');
    expect(html).toContain('<h1>My planning notes</h1>');
    expect(html).toContain('[[Ideas]]');
    expect(html).not.toContain('Work/Plan');
    expect(notice).toHaveBeenCalledWith('Created sources/My planning notes.md', 'success');
    expect(useStore.getState().ingestOpen).toBe(false);
  });

  it('with no related notes it says so, and has nothing to review', async () => {
    vi.mocked(retrieveChunks).mockResolvedValue({ mode: 'lexical', chunks: [] });
    await prepare();
    expect(screen.getByText('No related notes were found.')).toBeInTheDocument();
    expect(document.querySelector('[data-change]')).toBeNull();
  });

  it('says when the source was long and only the first part was read', async () => {
    ingestFetch.mockResolvedValueOnce({ success: true, data: { url: 'https://example.com/post', title: 'Long', text: ARTICLE, truncated: true } });
    await prepare();
    expect(screen.getByTestId('ingest-clipped')).toHaveTextContent('only its first part');
  });

  it('a page that cannot be read says why, and the person can try again', async () => {
    ingestFetch.mockResolvedValueOnce({ success: false, error: 'that is a PDF; PDFs are not read yet', code: 'pdf' });
    open();
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com/x.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read and summarise' }));
    expect(await screen.findByTestId('ingest-error')).toHaveTextContent('PDFs are not read yet');
    expect(screen.getByLabelText('Web address')).toBeEnabled();
  });

  it('a model that fails says so and leaves the dialog as it was', async () => {
    vi.mocked(askLLM).mockRejectedValueOnce(new Error('no key'));
    open();
    fireEvent.change(screen.getByLabelText('Or paste text'), { target: { value: ARTICLE } });
    fireEvent.click(screen.getByRole('button', { name: 'Read and summarise' }));
    expect(await screen.findByTestId('ingest-error')).toHaveTextContent('The model could not do it: no key');
  });

  it('"only with a model on this computer" is a setting that is remembered, and with a cloud model nothing is fetched', async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, llmProvider: 'openai' } });
    open();
    fireEvent.click(screen.getByLabelText(/Only with a model on this computer/));
    expect(useStore.getState().settings.ingestLocalOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com/post' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read and summarise' }));
    expect(await screen.findByTestId('ingest-error')).toHaveTextContent('is on, and the model in use is not one');
    expect(ingestFetch).not.toHaveBeenCalled();
    expect(askLLM).not.toHaveBeenCalled();
  });

  it('Back returns to the address, and the same dialog can read another source', async () => {
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Web address')).toBeInTheDocument();
  });

  it('cancelling closes it without writing', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().ingestOpen).toBe(false);
    expect(saveNote).not.toHaveBeenCalled();
  });
});
