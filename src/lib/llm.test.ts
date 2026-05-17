import { describe, it, expect, vi, beforeEach } from 'vitest';
import { askLLM } from './llm';
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

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchFail('Rate limit exceeded')
    );

    await expect(askLLM([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('Errore LLM: Rate limit exceeded');
  });
});
