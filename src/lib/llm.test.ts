import { describe, it, expect, vi, beforeEach } from 'vitest';
import { askLLM, describeLlmError, fetchAvailableModels, LlmHttpError, AbortedError } from './llm';
import { useStore } from '../store/useStore';

// Mock global fetch — responses must include text() since apiFetch reads via text()
globalThis.fetch = vi.fn();

const mockFetchOk = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const mockFetchFail = (body: string, status = 429) =>
  ({ ok: false, status, text: async () => body });

describe('llm API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it('should throw error if API key is missing for protected providers', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: '', llmModel: 'gpt-4o', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    await expect(askLLM([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('API Key non configurata nelle impostazioni.');
  });

  it('should format requests correctly for OpenAI', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchOk({ choices: [{ message: { content: 'OpenAI Response' } }] })
    );

    const res = await askLLM([{ role: 'user', content: 'hello' }]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key',
        }),
      })
    );
    expect(res).toBe('OpenAI Response');
  });

  it('should handle local LLM (Ollama) without API key', async () => {
    useStore.setState({
      settings: { llmProvider: 'ollama', llmApiKey: '', llmModel: 'llama3', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchOk({ message: { content: 'Ollama Response' } })
    );

    const res = await askLLM([{ role: 'user', content: 'hello' }]);

    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.any(Object));
    expect(res).toBe('Ollama Response');
  });

  it('should throw draconian error on fetch failure', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchFail('Rate limit exceeded')
    );

    await expect(askLLM([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('Errore LLM: Rate limit exceeded');
  });

  it('should map classified errors with describeLlmError', () => {
    expect(describeLlmError(new AbortedError(), 'en')).toContain('Request cancelled');
    expect(describeLlmError(new LlmHttpError(429, 'limit'), 'en')).toContain('Rate limit');
    expect(describeLlmError(new LlmHttpError(401, 'auth'), 'it')).toContain('API key');
  });

  it('should discover models from LM Studio and Ollama', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockFetchOk({ data: [{ id: 'model-a' }] }))
      .mockResolvedValueOnce(mockFetchOk({ models: [{ name: 'llama3.1' }] }));

    await expect(fetchAvailableModels('lmstudio', 'localhost:1234/v1/')).resolves.toEqual(['model-a']);
    await expect(fetchAvailableModels('ollama', '')).resolves.toEqual(['llama3.1']);
  });

  it('should call OpenRouter with normalized no-system payload for gemma models', async () => {
    useStore.setState({
      settings: { llmProvider: 'openrouter', llmApiKey: 'k', llmModel: 'google/gemma-2-9b-it', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchOk({ choices: [{ message: { content: 'OpenRouter OK' } }] })
    );

    const res = await askLLM([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hello' },
    ]);

    const lastCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(lastCall?.[1]?.body as string) as { messages: { role: string; content: string }[] };
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('Istruzioni sistema');
    expect(res).toBe('OpenRouter OK');
  });

  it('should wrap provider errors with LLM prefix preserving message', async () => {
    useStore.setState({
      settings: { llmProvider: 'lmstudio', llmApiKey: '', llmModel: 'local', lmStudioUrl: 'http://localhost:1234/v1', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchFail('down', 503)
    );

    await expect(askLLM([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('Errore LLM: LM Studio');
  });

  it('should call Anthropic and parse text response', async () => {
    useStore.setState({
      settings: { llmProvider: 'anthropic', llmApiKey: 'ak', llmModel: 'claude-3-5-sonnet-20241022', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchOk({ content: [{ text: 'Anthropic OK' }] })
    );

    await expect(askLLM([{ role: 'user', content: 'hi' }])).resolves.toBe('Anthropic OK');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
  });

  it('should call Gemini and parse candidate text response', async () => {
    useStore.setState({
      settings: { llmProvider: 'gemini', llmApiKey: 'gk', llmModel: 'gemini-1.5-pro', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchOk({ candidates: [{ content: { parts: [{ text: 'Gemini OK' }] } }] })
    );

    await expect(askLLM([{ role: 'user', content: 'hi' }])).resolves.toBe('Gemini OK');
  });

  it('should keep AbortedError unwrapped', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const ac = new AbortController();
    ac.abort();
    await expect(askLLM([{ role: 'user', content: 'hello' }], { signal: ac.signal }))
      .rejects.toBeInstanceOf(AbortedError);
  });

  it('should return provider-specific mapped messages for 404 and 5xx', () => {
    expect(describeLlmError(new LlmHttpError(404, 'missing'), 'en')).toContain('Model not found');
    expect(describeLlmError(new LlmHttpError(503, 'down'), 'it')).toContain('temporaneamente');
  });

  it('should retry transient failures up to max attempts (OpenAI)', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValue(mockFetchFail('retry-me', 429));

    await expect(askLLM([{ role: 'user', content: 'hello' }])).rejects.toThrow('Errore LLM: retry-me');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('should fail on empty payloads for Anthropic/Gemini/OpenRouter', async () => {
    useStore.setState({
      settings: { llmProvider: 'anthropic', llmApiKey: 'ak', llmModel: 'claude-3-5-sonnet-20241022', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchOk({ content: [] }));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: Risposta Anthropic vuota o non valida');

    useStore.setState({
      settings: { llmProvider: 'gemini', llmApiKey: 'gk', llmModel: 'gemini-1.5-pro', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchOk({ candidates: [] }));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: Risposta Gemini vuota o non valida');

    useStore.setState({
      settings: { llmProvider: 'openrouter', llmApiKey: 'rk', llmModel: 'anthropic/claude-3.5-sonnet', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchOk({ choices: [] }));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: Risposta OpenRouter vuota o non valida');
  });

  it('should surface provider-specific non-ok errors for Anthropic/Gemini/OpenRouter', async () => {
    useStore.setState({
      settings: { llmProvider: 'anthropic', llmApiKey: 'ak', llmModel: 'claude-3-5-sonnet-20241022', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchFail('anthropic-fail', 401));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: anthropic-fail');

    useStore.setState({
      settings: { llmProvider: 'gemini', llmApiKey: 'gk', llmModel: 'gemini-1.5-pro', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchFail('gemini-fail', 400));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: gemini-fail');

    useStore.setState({
      settings: { llmProvider: 'openrouter', llmApiKey: 'rk', llmModel: 'anthropic/claude-3.5-sonnet', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchFail('openrouter-fail', 400));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: openrouter-fail');
  });

  it('should timeout on electron llmFetch path when request never resolves', async () => {
    vi.useFakeTimers();
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    const originalLlmFetch = window.electronAPI.llmFetch;
    window.electronAPI.llmFetch = vi.fn(() => new Promise(() => undefined));

    const p = askLLM([{ role: 'user', content: 'hello' }]);
    const assertion = expect(p).rejects.toThrow('Errore LLM: Richiesta LLM scaduta');
    await vi.advanceTimersByTimeAsync(183000);
    await assertion;

    window.electronAPI.llmFetch = originalLlmFetch;
    vi.useRealTimers();
  });

  it('should surface LMStudio/Ollama unreachable messages when status is 0', async () => {
    useStore.setState({
      settings: { llmProvider: 'lmstudio', llmApiKey: '', llmModel: 'local', lmStudioUrl: 'http://localhost:1234/v1', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchFail('x', 0));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: LM Studio');

    useStore.setState({
      settings: { llmProvider: 'ollama', llmApiKey: '', llmModel: 'llama3', lmStudioUrl: '', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchFail('x', 0));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: Ollama');
  });

  it('should fail when LMStudio returns empty choices content', async () => {
    useStore.setState({
      settings: { llmProvider: 'lmstudio', llmApiKey: '', llmModel: 'local', lmStudioUrl: 'http://localhost:1234/v1', syncDirectory: null, showToolbar: true, showAiBar: true, theme: 'auto' as const, focusMode: false, editorFont: 'system' as const, editorFontSize: 'md' as const, typewriterMode: false, accentColor: '#6366f1' }
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchOk({ choices: [] }));
    await expect(askLLM([{ role: 'user', content: 'x' }])).rejects.toThrow('Errore LLM: LM Studio: risposta vuota o non valida');
  });
});
