import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiChat } from './AiChat';
import { useStore } from '../store/useStore';
import { AbortedError } from '../lib/llm';

const streamLLMMock = vi.fn(async () => 'ok');
const hybridMock = vi.fn(async () => ({ notes: [], mode: 'lexical' as const, scored: [] }));

vi.mock('../lib/llm', () => {
  class MockAbortedError extends Error {}
  return {
    streamLLM: (...args: unknown[]) => streamLLMMock(...args),
    AbortedError: MockAbortedError,
    describeLlmError: (err: unknown, lang: string) => `err_${lang}`,
  };
});

vi.mock('../lib/noteSearch', () => ({
  findRelevantNotesHybrid: (...args: unknown[]) => hybridMock(...args),
}));

describe('AiChat retrieval mode wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    useStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        llmProvider: 'lmstudio',
        llmModel: 'local',
        llmApiKey: 'k',
        embeddingsEnabled: false,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        ragDebug: false,
        ragContextChars: 8000,
        piiMasking: false,
      },
    }));
  });

  it('passes lexical config when embeddings are disabled', async () => {
    render(<AiChat getEditorText={() => 'hello'} retrieveNotes={async () => [{ name: 'a.md', text: 'hello world' }]} noteCount={1} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'query test' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(hybridMock).toHaveBeenCalled());
    const lastCall = hybridMock.mock.calls.at(-1);
    const cfg = lastCall?.[3] as { enabled: boolean };
    expect(cfg.enabled).toBe(false);
  });

  it('passes hybrid config when embeddings are enabled', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, embeddingsEnabled: true },
    }));

    render(<AiChat getEditorText={() => 'hello'} retrieveNotes={async () => [{ name: 'a.md', text: 'hello world' }]} noteCount={1} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'query test' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(hybridMock).toHaveBeenCalled());
    const lastCall = hybridMock.mock.calls.at(-1);
    const cfg = lastCall?.[3] as { enabled: boolean; provider: string; model: string };
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('text-embedding-3-small');
  });

  it('asks for candidates only when a question is sent (not on mount), with that question, and ranks only those', async () => {
    const retrieve = vi.fn(async (_q: string) => [{ name: 'a.md', text: 'hello world' }, { name: 'b.md', text: 'other' }]);
    render(<AiChat getEditorText={() => 'hello'} retrieveNotes={retrieve} noteCount={812} />);
    expect(retrieve).not.toHaveBeenCalled(); // opening the panel reads nothing
    expect(screen.getByText(/812/)).toBeTruthy(); // the badge reports the vault size, not a capped sample

    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'what is quokka' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(hybridMock).toHaveBeenCalled());
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith('what is quokka');
    // The re-ranker receives exactly the candidates, nothing else.
    expect(hybridMock.mock.calls.at(-1)?.[1]).toEqual([{ name: 'a.md', text: 'hello world' }, { name: 'b.md', text: 'other' }]);
  });

  it('still answers, without related notes, when retrieval fails', async () => {
    const retrieve = vi.fn(async () => { throw new Error('index busy'); });
    render(<AiChat getEditorText={() => 'hello'} retrieveNotes={retrieve} noteCount={3} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'question' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(retrieve).toHaveBeenCalled());
    expect(hybridMock).not.toHaveBeenCalled(); // nothing to rank
    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
  });

  it('clears chat history and aborts current query on clear click', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    render(<AiChat getEditorText={() => 'hello'} />);
    
    // Trigger user query to make controller active
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'my question' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for display update
    expect(screen.getByText('my question')).toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: /Clear conversation/i });
    fireEvent.click(clearBtn);

    expect(abortSpy).toHaveBeenCalled();
    expect(screen.queryByText('my question')).not.toBeInTheDocument();
  });

  it('shows a Stop button while a query is in flight and aborts it when clicked', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    // Never resolves, so the request stays in flight and the Stop button renders.
    streamLLMMock.mockImplementationOnce(() => new Promise(() => undefined));
    render(<AiChat getEditorText={() => 'ctx'} />);

    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'slow query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const stopBtn = await screen.findByRole('button', { name: /stop/i });
    fireEvent.click(stopBtn);
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('handles AbortedError gracefully without adding error messages to chat', async () => {
    streamLLMMock.mockRejectedValueOnce(new AbortedError('Aborted'));
    render(<AiChat getEditorText={() => 'hello'} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'fail query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    
    // It should not show an error bubble or assistant text (except possibly thinking spinner going away)
    // Wait for the input to be enabled again
    await waitFor(() => expect(screen.getByPlaceholderText(/ask something/i)).not.toBeDisabled());
    expect(screen.queryByText(/Error:/i)).not.toBeInTheDocument();
  });

  it('shows the answer as it is written, then keeps it as the answer', async () => {
    let finish: (text: string) => void = () => undefined;
    streamLLMMock.mockImplementationOnce((_messages: unknown, opts: { onText: (t: string) => void }) => {
      opts.onText('The first ');
      opts.onText('words');
      return new Promise<string>(resolve => { finish = resolve; });
    });
    render(<AiChat getEditorText={() => 'ctx'} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'tell me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('The first words')).toBeInTheDocument();
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument(); // text has started: no more spinner
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

    finish('The first words, and the rest.');
    expect(await screen.findByText('The first words, and the rest.')).toBeInTheDocument();
    expect(screen.queryByText('The first words')).not.toBeInTheDocument(); // the streamed bubble was replaced, not kept beside it
    await waitFor(() => expect(screen.getByPlaceholderText(/ask something/i)).not.toBeDisabled());
  });

  it('stopping keeps what the model had written, with no error', async () => {
    streamLLMMock.mockImplementationOnce(async (_messages: unknown, opts: { onText: (t: string) => void }) => {
      opts.onText('Half an ans');
      throw new AbortedError('Aborted');
    });
    render(<AiChat getEditorText={() => 'ctx'} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'tell me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('Half an ans')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText(/ask something/i)).not.toBeDisabled());
    expect(screen.queryByText(/err_/)).not.toBeInTheDocument();
  });

  it('an answer that fails half way keeps the part there is, and says what went wrong', async () => {
    streamLLMMock.mockImplementationOnce(async (_messages: unknown, opts: { onText: (t: string) => void }) => {
      opts.onText('Partial text');
      throw new Error('overloaded');
    });
    render(<AiChat getEditorText={() => 'ctx'} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'tell me' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Partial text')).toBeInTheDocument();
    expect(await screen.findByText(/err_/)).toBeInTheDocument();
  });

  it('clearing the chat while an answer is arriving does not bring the answer back', async () => {
    streamLLMMock.mockImplementationOnce((_messages: unknown, opts: { onText: (t: string) => void; signal: AbortSignal }) => {
      opts.onText('Words that must go');
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new AbortedError('Aborted'))));
    });
    render(<AiChat getEditorText={() => 'ctx'} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'tell me' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Words that must go')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/ask something/i)).not.toBeDisabled());
    expect(screen.queryByText('Words that must go')).not.toBeInTheDocument();
  });

  it('one masker serves the whole conversation, so a token means the same value in every turn', async () => {
    useStore.setState(state => ({ settings: { ...state.settings, piiMasking: true } }));
    const maskers: unknown[] = [];
    streamLLMMock.mockImplementation(async (_messages: unknown, opts: { masker?: unknown }) => { maskers.push(opts.masker); return 'ok'; });
    render(<AiChat getEditorText={() => ''} />);
    const input = () => screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input(), { target: { value: 'mail ana@example.com' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(input()).not.toBeDisabled());
    fireEvent.change(input(), { target: { value: 'and bob@example.org' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(maskers).toHaveLength(2));
    expect(maskers[0]).toBeDefined();
    expect(maskers[1]).toBe(maskers[0]);
    const second = streamLLMMock.mock.calls.at(-1)?.[0] as { role: string; content: string }[];
    expect(second.filter(m => m.role === 'user').map(m => m.content)).toEqual(['mail [EMAIL_1]', 'and [EMAIL_2]']);
  });

  it('displays friendly error when streamLLM throws a generic error', async () => {
    streamLLMMock.mockRejectedValueOnce(new Error('Unknown backend error'));
    render(<AiChat getEditorText={() => 'hello'} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'error query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    
    // Should display the error message populated with 'err_en' since default language is English
    await waitFor(() => expect(screen.getByText(/Error: err_en/i)).toBeInTheDocument());
  });

  it('renders RAG debug info when enabled and shows retrieval scores', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, ragDebug: true },
    }));

    hybridMock.mockResolvedValueOnce({
      notes: [{ name: 'note-a.md', text: 'content a' }],
      mode: 'hybrid',
      scored: [
        {
          note: { name: 'note-a.md', text: 'content a' },
          lexical: 0.75,
          dense: 0.85,
          combined: 0.80,
        },
      ],
    });

    render(<AiChat getEditorText={() => 'hello'} retrieveNotes={async () => [{ name: 'note-a.md', text: 'content a' }]} noteCount={1} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'rag test query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/RAG Debug · hybrid/i)).toBeInTheDocument());
    expect(screen.getByText(/note-a/i)).toBeInTheDocument();
    expect(screen.getByText(/L 0.75 · D 0.85 · C 0.80/i)).toBeInTheDocument();
  });

  it('renders standard RAG debug empty state when no retrieval scores exist', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, ragDebug: true },
    }));

    render(<AiChat getEditorText={() => 'hello'} />);
    expect(screen.getByText(/No retrieval scores yet/i)).toBeInTheDocument();
  });

  it('truncates context correctly at last paragraph break when exceeding limit', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, ragContextChars: 1500 },
    }));

    // Text length is 1600. Last paragraph break \n\n is at index 1000 (which is > 900)
    const baseText = 'a'.repeat(1000) + '\n\n' + 'b'.repeat(598);
    expect(baseText.length).toBe(1600);

    render(<AiChat getEditorText={() => baseText} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'trunc query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    const sysMsg = streamLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    
    // It should truncate at index 1000 (the last paragraph break)
    const expectedTruncated = 'a'.repeat(1000);
    expect(sysMsg).toContain(expectedTruncated);
    expect(sysMsg).not.toContain('b');
    expect(sysMsg).toContain('[...document truncated for length...]');
  });

  it('truncates context correctly at last newline break when exceeding limit with no paragraph break in range', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, ragContextChars: 1500 },
    }));

    // Text length is 1600. Last newline \n is at index 1000 (which is > 900)
    // No \n\n in the range
    const baseText = 'a'.repeat(1000) + '\n' + 'b'.repeat(599);
    expect(baseText.length).toBe(1600);

    render(<AiChat getEditorText={() => baseText} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'trunc query 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    const sysMsg = streamLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    
    // It should truncate at index 1000 (the last newline)
    const expectedTruncated = 'a'.repeat(1000);
    expect(sysMsg).toContain(expectedTruncated);
    expect(sysMsg).not.toContain('b');
    expect(sysMsg).toContain('[...document truncated for length...]');
  });

  it('falls back to hard cut when exceeding limit with no breaks in range', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, ragContextChars: 1500 },
    }));

    // Text length is 1600. No \n or \n\n at all.
    const baseText = 'a'.repeat(1600);

    render(<AiChat getEditorText={() => baseText} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'trunc query 3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    const sysMsg = streamLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    
    // It should truncate at 1500 characters
    const expectedTruncated = 'a'.repeat(1500);
    expect(sysMsg).toContain(expectedTruncated);
    expect(sysMsg).toContain('[...document truncated for length...]');
  });

  it('masks user message and editor context when PII masking is enabled', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, piiMasking: true },
    }));

    render(<AiChat getEditorText={() => 'My email is user@domain.com'} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'Contact me at +39 02 1234567' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    
    // The user message in llm history should be masked
    // Let's check streamLLM calls:
    const calls = streamLLMMock.mock.calls.at(-1);
    const messages = calls?.[0] as { role: string; content: string }[];
    
    // System message should contain masked context
    const sysMsg = messages[0].content;
    expect(sysMsg).toContain('[EMAIL_1]');
    expect(sysMsg).not.toContain('user@domain.com');

    // User message (second message in array) should contain masked phone
    const userMsg = messages[1].content;
    expect(userMsg).toContain('[PHONE_1]');
    expect(userMsg).not.toContain('+39 02 1234567');

    // PII notice should show up in UI
    expect(screen.getByText(/PII Masking/i)).toBeInTheDocument();
    // 2 items masked total (1 email from context + 1 phone from user query)
    expect(screen.getByText(/2 items masked before sending/i)).toBeInTheDocument();
  });

  it('handles Italian language setting correctly for system instructions and errors', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, language: 'it' },
    }));

    streamLLMMock.mockRejectedValueOnce(new Error('Italian error'));

    render(<AiChat getEditorText={() => 'ciao'} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Chiedi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(streamLLMMock).toHaveBeenCalled());
    
    // The language passed to describeLlmError should be 'it'
    const sysMsg = streamLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    expect(sysMsg).toContain('Sei un assistente integrato');
    
    // Friendly error should be populated with 'err_it'
    await waitFor(() => expect(screen.getByText(/Errore: err_it/i)).toBeInTheDocument());
  });

  it('does not reset abortRef if controller was superseded by a new request', async () => {
    let inputEl: HTMLInputElement | null = null;
    let askCount = 0;
    
    streamLLMMock.mockImplementation(async () => {
      askCount++;
      if (askCount === 1) {
        if (inputEl) {
          fireEvent.change(inputEl, { target: { value: 'query 2' } });
          fireEvent.keyDown(inputEl, { key: 'Enter' });
        }
        throw new AbortedError('Aborted');
      }
      return 'second-ok';
    });

    render(<AiChat getEditorText={() => 'hello'} />);

    inputEl = screen.getByRole('textbox') as HTMLInputElement;
    
    // First query
    fireEvent.change(inputEl, { target: { value: 'query 1' } });
    fireEvent.keyDown(inputEl, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('second-ok')).toBeInTheDocument());
  });
});
