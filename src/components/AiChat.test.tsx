import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiChat } from './AiChat';
import { useStore } from '../store/useStore';
import { AbortedError } from '../lib/llm';

const askLLMMock = vi.fn(async () => 'ok');
const hybridMock = vi.fn(async () => ({ notes: [], mode: 'lexical' as const, scored: [] }));

vi.mock('../lib/llm', () => {
  class MockAbortedError extends Error {}
  return {
    askLLM: (...args: unknown[]) => askLLMMock(...args),
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
    render(<AiChat getEditorText={() => 'hello'} noteChunks={[{ name: 'a.md', text: 'hello world' }]} />);
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

    render(<AiChat getEditorText={() => 'hello'} noteChunks={[{ name: 'a.md', text: 'hello world' }]} />);
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

  it('clears chat history and aborts current query on clear click', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    render(<AiChat getEditorText={() => 'hello'} noteChunks={[]} />);
    
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
    askLLMMock.mockImplementationOnce(() => new Promise(() => undefined));
    render(<AiChat getEditorText={() => 'ctx'} noteChunks={[]} />);

    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'slow query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const stopBtn = await screen.findByRole('button', { name: /stop/i });
    fireEvent.click(stopBtn);
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('handles AbortedError gracefully without adding error messages to chat', async () => {
    askLLMMock.mockRejectedValueOnce(new AbortedError('Aborted'));
    render(<AiChat getEditorText={() => 'hello'} noteChunks={[]} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'fail query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    
    // It should not show an error bubble or assistant text (except possibly thinking spinner going away)
    // Wait for the input to be enabled again
    await waitFor(() => expect(screen.getByPlaceholderText(/ask something/i)).not.toBeDisabled());
    expect(screen.queryByText(/Error:/i)).not.toBeInTheDocument();
  });

  it('displays friendly error when askLLM throws a generic error', async () => {
    askLLMMock.mockRejectedValueOnce(new Error('Unknown backend error'));
    render(<AiChat getEditorText={() => 'hello'} noteChunks={[]} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'error query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    
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

    render(<AiChat getEditorText={() => 'hello'} noteChunks={[{ name: 'note-a.md', text: 'content a' }]} />);
    
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

    render(<AiChat getEditorText={() => 'hello'} noteChunks={[]} />);
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

    render(<AiChat getEditorText={() => baseText} noteChunks={[]} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'trunc query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    const sysMsg = askLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    
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

    render(<AiChat getEditorText={() => baseText} noteChunks={[]} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'trunc query 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    const sysMsg = askLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    
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

    render(<AiChat getEditorText={() => baseText} noteChunks={[]} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'trunc query 3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    const sysMsg = askLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    
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

    render(<AiChat getEditorText={() => 'My email is user@domain.com'} noteChunks={[]} />);
    
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'Contact me at +39 02 1234567' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    
    // The user message in llm history should be masked
    // Let's check askLLM calls:
    const calls = askLLMMock.mock.calls.at(-1);
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

    askLLMMock.mockRejectedValueOnce(new Error('Italian error'));

    render(<AiChat getEditorText={() => 'ciao'} noteChunks={[]} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Chiedi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askLLMMock).toHaveBeenCalled());
    
    // The language passed to describeLlmError should be 'it'
    const sysMsg = askLLMMock.mock.calls.at(-1)?.[0]?.[0]?.content;
    expect(sysMsg).toContain('Sei un assistente integrato');
    
    // Friendly error should be populated with 'err_it'
    await waitFor(() => expect(screen.getByText(/Errore: err_it/i)).toBeInTheDocument());
  });

  it('does not reset abortRef if controller was superseded by a new request', async () => {
    let inputEl: HTMLInputElement | null = null;
    let askCount = 0;
    
    askLLMMock.mockImplementation(async () => {
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

    render(<AiChat getEditorText={() => 'hello'} noteChunks={[]} />);

    inputEl = screen.getByRole('textbox') as HTMLInputElement;
    
    // First query
    fireEvent.change(inputEl, { target: { value: 'query 1' } });
    fireEvent.keyDown(inputEl, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('second-ok')).toBeInTheDocument());
  });
});
