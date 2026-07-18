import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { findRelevantNotes, findRelevantNotesHybrid, type NoteChunk } from './noteSearch';

describe('noteSearch', () => {
  const notes: NoteChunk[] = [
    { name: 'ai.md', text: 'artificial intelligence machine learning neural networks' },
    { name: 'gardening.md', text: 'soil watering tomatoes basil balcony garden tips' },
    { name: 'finance.md', text: 'cashflow runway budgeting startup expenses accounting' },
  ];

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (window as any).electronAPI;
  });

  it('returns lexical results for plain retrieval', () => {
    const result = findRelevantNotes('machine learning model', notes, 2);
    expect(result[0].name).toBe('ai.md');
    expect(result).toHaveLength(1);
  });

  it('falls back to lexical when hybrid is disabled', async () => {
    const result = await findRelevantNotesHybrid('tomatoes basil', notes, 2, {
      enabled: false,
      provider: 'none',
      model: '',
    });
    expect(result.mode).toBe('lexical');
    expect(result.notes[0].name).toBe('gardening.md');
  });

  it('falls back to lexical when embeddings provider fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as typeof fetch;

    const result = await findRelevantNotesHybrid('runway startup budget', notes, 2, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    });
    expect(result.mode).toBe('lexical');
    expect(result.notes[0].name).toBe('finance.md');
  });

  it('uses hybrid mode when embeddings are available', async () => {
    const embeddingsByText: Record<string, number[]> = {
      'machine learning model': [1, 0, 0],
      'artificial intelligence machine learning neural networks': [0.95, 0.05, 0],
      'soil watering tomatoes basil balcony garden tips': [0, 1, 0],
      'cashflow runway budgeting startup expenses accounting': [0.2, 0.1, 0.7],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string };
      const emb = embeddingsByText[body.input ?? ''] ?? [0, 0, 1];
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ embedding: emb }] }),
      };
    }) as typeof fetch;

    const result = await findRelevantNotesHybrid('machine learning model', notes, 2, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    });

    expect(result.mode).toBe('hybrid');
    expect(result.notes[0].name).toBe('ai.md');
  });

  it('supports lmstudio provider with various base URL normalizations', async () => {
    let requestedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
      };
    }) as any;

    const result = await findRelevantNotesHybrid('lmquery-1', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'lmstudio',
      model: 'nomic-embed-text',
      lmStudioUrl: 'localhost:8080/v1/',
    });
    expect(result.mode).toBe('hybrid');
    expect(requestedUrl).toBe('http://localhost:8080/v1/embeddings');

    // Test with empty/default URL - using unique query to avoid cache
    await findRelevantNotesHybrid('lmquery-2', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'lmstudio',
      model: 'nomic-embed-text',
      lmStudioUrl: '',
    });
    expect(requestedUrl).toBe('http://localhost:1234/v1/embeddings');

    // Test with https protocol already included - using unique query to avoid cache
    await findRelevantNotesHybrid('lmquery-3', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'lmstudio',
      model: 'nomic-embed-text',
      lmStudioUrl: 'https://custom-domain.com',
    });
    expect(requestedUrl).toBe('https://custom-domain.com/embeddings');
  });

  it('supports ollama provider for embeddings', async () => {
    let requestedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ embedding: [0.3, 0.4] }),
      };
    }) as any;

    const result = await findRelevantNotesHybrid('ollamaquery', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'ollama',
      model: 'all-minilm',
    });
    expect(result.mode).toBe('hybrid');
    expect(requestedUrl).toBe('http://localhost:11434/api/embeddings');
  });

  it('handles empty OpenAI embedding response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [] }),
    }) as any;

    const result = await findRelevantNotesHybrid('openai-empty-query', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    });
    expect(result.mode).toBe('lexical');
  });

  it('throws error / falls back when OpenAI API key is missing', async () => {
    const result = await findRelevantNotesHybrid('openai-missing-key-query', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: '',
    });
    expect(result.mode).toBe('lexical');
  });

  it('handles empty Ollama embedding response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    }) as any;

    const result = await findRelevantNotesHybrid('ollama-empty-query', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'ollama',
      model: 'all-minilm',
    });
    expect(result.mode).toBe('lexical');
  });

  it('handles LM Studio error HTTP status code', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    }) as any;

    const result = await findRelevantNotesHybrid('lmstudio-error-query', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'lmstudio',
      model: 'nomic-embed-text',
    });
    expect(result.mode).toBe('lexical');
  });

  it('handles Ollama error HTTP status code', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Error',
    }) as any;

    const result = await findRelevantNotesHybrid('ollama-error-query', [{ name: 'a.md', text: 'hello' }], 1, {
      enabled: true,
      provider: 'ollama',
      model: 'all-minilm',
    });
    expect(result.mode).toBe('lexical');
  });

  it('returns empty results when notes array is empty', async () => {
    const result = await findRelevantNotesHybrid('empty-notes-query', [], 1, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
    });
    expect(result.notes).toEqual([]);
    expect(result.scored).toEqual([]);
  });

  it('uses cached embeddings on subsequent lookups and handles note update eviction', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ embedding: [0.5, 0.5] }] }),
    }) as any;
    globalThis.fetch = fetchSpy;

    const cfg = {
      enabled: true,
      provider: 'openai' as const,
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    };

    // First run - populates cache for query 'hello-cache' and note 'a.md'
    await findRelevantNotesHybrid('hello-cache', [{ name: 'a.md', text: 'initial' }], 1, cfg);
    const callCount1 = fetchSpy.mock.calls.length;

    // Second run with same text - should hit cache and NOT fetch embeddings again
    await findRelevantNotesHybrid('hello-cache', [{ name: 'a.md', text: 'initial' }], 1, cfg);
    expect(fetchSpy.mock.calls.length).toBe(callCount1);

    // Third run with updated note text - should evict old and fetch new embedding for 'a.md'
    await findRelevantNotesHybrid('hello-cache', [{ name: 'a.md', text: 'changed content' }], 1, cfg);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callCount1);
  });

  it('handles zero vectors and mismatching vector lengths in dense similarity', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callNum++;
      const emb = callNum === 1 ? [1, 0] : [1, 0, 0]; // mismatch lengths
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ embedding: emb }] }),
      };
    }) as any;

    // Note matches lexically so lexical score > 0, ensuring combined > 0 and row is not filtered out
    const result = await findRelevantNotesHybrid('dense-zero-query', [{ name: 'a.md', text: 'dense zero query' }], 1, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    });
    expect(result.mode).toBe('hybrid');
    expect(result.scored[0].dense).toBe(0);
  });

  it('handles zero vector norms in dense similarity', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callNum++;
      const emb = callNum === 1 ? [0, 0] : [1, 1]; // zero vector first
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ embedding: emb }] }),
      };
    }) as any;

    // Note matches lexically so lexical score > 0, ensuring combined > 0 and row is not filtered out
    const result = await findRelevantNotesHybrid('norm-zero-query', [{ name: 'a.md', text: 'norm zero query' }], 1, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    });
    expect(result.scored[0].dense).toBe(0);
  });

  it('uses electronAPI.llmFetch if available', async () => {
    const mockLlmFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [0.99] }] }),
    });
    (window as any).electronAPI = { llmFetch: mockLlmFetch };

    const result = await findRelevantNotesHybrid('electron-fetch-query', [{ name: 'a.md', text: 'electron fetch note' }], 1, {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    });
    expect(result.mode).toBe('hybrid');
    expect(mockLlmFetch).toHaveBeenCalled();
  });
});

