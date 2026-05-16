import { describe, it, expect, vi, beforeEach } from 'vitest';
import { askLLM } from './llm';
import { useStore } from '../store/useStore';

// Mock global fetch
global.fetch = vi.fn();

describe('llm API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error if API key is missing for protected providers', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: '', llmModel: 'gpt-4o', lmStudioUrl: '' }
    });

    await expect(askLLM([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('API Key non configurata nelle impostazioni.');
  });

  it('should format requests correctly for OpenAI', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '' }
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'OpenAI Response' } }] })
    });

    const res = await askLLM([{ role: 'user', content: 'hello' }]);
    
    expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key'
      }
    }));
    expect(res).toBe('OpenAI Response');
  });

  it('should handle local LLM (Ollama) without API key', async () => {
    useStore.setState({
      settings: { llmProvider: 'ollama', llmApiKey: '', llmModel: 'llama3', lmStudioUrl: '' }
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: 'Ollama Response' } })
    });

    const res = await askLLM([{ role: 'user', content: 'hello' }]);
    
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.any(Object));
    expect(res).toBe('Ollama Response');
  });

  it('should throw draconian error on fetch failure', async () => {
    useStore.setState({
      settings: { llmProvider: 'openai', llmApiKey: 'test-key', llmModel: 'gpt-4o', lmStudioUrl: '' }
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      text: async () => 'Rate limit exceeded'
    });

    await expect(askLLM([{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('Errore LLM: Rate limit exceeded');
  });
});