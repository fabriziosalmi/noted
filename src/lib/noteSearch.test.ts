import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findRelevantNotes, findRelevantNotesHybrid, type NoteChunk } from './noteSearch';

describe('noteSearch', () => {
  const notes: NoteChunk[] = [
    { name: 'ai.md', text: 'artificial intelligence machine learning neural networks' },
    { name: 'gardening.md', text: 'soil watering tomatoes basil balcony garden tips' },
    { name: 'finance.md', text: 'cashflow runway budgeting startup expenses accounting' },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
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
});
