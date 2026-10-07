import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQueryCache, EMBED_BATCH, embedQuery, embedTexts, embeddingConfigOf, EmbeddingHttpError, type EmbeddingConfig } from './embeddings';

const original = window.electronAPI;
const llmFetch = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, text: JSON.stringify(body) });
const calls = () => llmFetch.mock.calls as [string, { method: string; headers: Record<string, string>; body: string }][];
const bodyOf = (i: number) => JSON.parse(calls()[i][1].body) as Record<string, unknown>;

beforeEach(() => { llmFetch.mockReset(); clearQueryCache(); window.electronAPI = { ...original, llmFetch } as unknown as typeof window.electronAPI; });
afterEach(() => { window.electronAPI = original; });

const openai: EmbeddingConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk', maskPii: true };
const lmstudio: EmbeddingConfig = { provider: 'lmstudio', model: 'nomic', lmStudioUrl: 'http://localhost:1234/v1' };
const ollama: EmbeddingConfig = { provider: 'ollama', model: 'nomic-embed-text' };

describe('embeddingConfigOf', () => {
  it('is null until embeddings are on, a provider and a model are chosen (and a key, for OpenAI)', () => {
    expect(embeddingConfigOf({})).toBeNull();
    expect(embeddingConfigOf({ embeddingsEnabled: true, embeddingProvider: 'none', embeddingModel: 'x' })).toBeNull();
    expect(embeddingConfigOf({ embeddingsEnabled: true, embeddingProvider: 'ollama', embeddingModel: '  ' })).toBeNull();
    expect(embeddingConfigOf({ embeddingsEnabled: true, embeddingProvider: 'openai', embeddingModel: 'm' })).toBeNull();
    expect(embeddingConfigOf({ embeddingsEnabled: false, embeddingProvider: 'ollama', embeddingModel: 'm' })).toBeNull();
    expect(embeddingConfigOf({ embeddingsEnabled: true, embeddingProvider: 'ollama', embeddingModel: ' m ' })).toMatchObject({ provider: 'ollama', model: 'm', maskPii: true });
    expect(embeddingConfigOf({ embeddingsEnabled: true, embeddingProvider: 'openai', embeddingModel: 'm', llmApiKey: 'k', piiMasking: false })).toMatchObject({ apiKey: 'k', maskPii: false });
  });
});

describe('embedTexts', () => {
  it('OpenAI: one request for the batch, vectors back in the order of the texts even if the reply is shuffled, personal data masked', async () => {
    llmFetch.mockResolvedValueOnce(reply({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }));
    const out = await embedTexts(openai, ['write to ana@example.com', 'plain']);
    expect(out.map(v => Array.from(v))).toEqual([[1, 0], [0, 1]]);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][0]).toBe('https://api.openai.com/v1/embeddings');
    expect(calls()[0][1].headers.Authorization).toBe('Bearer sk');
    expect(bodyOf(0)).toEqual({ model: 'text-embedding-3-small', input: ['write to [EMAIL_1]', 'plain'] });
  });

  it('OpenAI with masking off sends the text as it is', async () => {
    llmFetch.mockResolvedValueOnce(reply({ data: [{ index: 0, embedding: [1] }] }));
    await embedTexts({ ...openai, maskPii: false }, ['ana@example.com']);
    expect(bodyOf(0).input).toEqual(['ana@example.com']);
  });

  it('LM Studio and Ollama are local: nothing is masked, nothing needs a key', async () => {
    llmFetch.mockResolvedValueOnce(reply({ data: [{ index: 0, embedding: [1, 2] }] }));
    await embedTexts(lmstudio, ['ana@example.com']);
    expect(calls()[0][0]).toBe('http://localhost:1234/v1/embeddings');
    expect(bodyOf(0)).toEqual({ model: 'nomic', input: ['ana@example.com'] });
    expect(calls()[0][1].headers.Authorization).toBeUndefined();
    llmFetch.mockResolvedValueOnce(reply({ embeddings: [[3, 4]] }));
    expect(Array.from((await embedTexts(ollama, ['x']))[0])).toEqual([3, 4]);
    expect(calls()[1][0]).toBe('http://localhost:11434/api/embed');
    expect(bodyOf(1)).toEqual({ model: 'nomic-embed-text', input: ['x'] });
  });

  it('an LM Studio address typed without a scheme is http for this machine and https for anything else', async () => {
    llmFetch.mockResolvedValue(reply({ data: [{ index: 0, embedding: [1] }] }));
    await embedTexts({ ...lmstudio, lmStudioUrl: 'localhost:1234/v1' }, ['x']);
    await embedTexts({ ...lmstudio, lmStudioUrl: 'models.example.com/v1' }, ['x']);
    expect(calls().map(c => c[0])).toEqual(['http://localhost:1234/v1/embeddings', 'https://models.example.com/v1/embeddings']);
  });

  it('an older Ollama (no /api/embed) is asked one text at a time', async () => {
    llmFetch.mockResolvedValueOnce(reply('not found', 404))
      .mockResolvedValueOnce(reply({ embedding: [1, 1] }))
      .mockResolvedValueOnce(reply({ embedding: [2, 2] }));
    const out = await embedTexts(ollama, ['a', 'b']);
    expect(out.map(v => Array.from(v))).toEqual([[1, 1], [2, 2]]);
    expect(calls().map(c => c[0])).toEqual(['http://localhost:11434/api/embed', 'http://localhost:11434/api/embeddings', 'http://localhost:11434/api/embeddings']);
    expect(bodyOf(1)).toEqual({ model: 'nomic-embed-text', prompt: 'a' });
  });

  it('a local server still loading its model (5xx) gets one more try', async () => {
    vi.useFakeTimers();
    try {
      llmFetch.mockResolvedValueOnce(reply('loading', 503)).mockResolvedValueOnce(reply({ data: [{ index: 0, embedding: [1] }] }));
      const p = embedTexts(lmstudio, ['x']);
      await vi.advanceTimersByTimeAsync(1600);
      expect(Array.from((await p)[0])).toEqual([1]);
      expect(llmFetch).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('a refusal is a typed error with the status; a reply with the wrong count is an error', async () => {
    llmFetch.mockResolvedValueOnce(reply({ error: 'bad key' }, 401));
    const err = await embedTexts(openai, ['x']).catch(e => e);
    expect(err).toBeInstanceOf(EmbeddingHttpError);
    expect((err as EmbeddingHttpError).status).toBe(401);
    llmFetch.mockResolvedValueOnce(reply({ data: [{ index: 0, embedding: [1] }] }));
    await expect(embedTexts(openai, ['a', 'b'])).rejects.toThrow(/1 embeddings for 2 texts/);
    llmFetch.mockResolvedValueOnce(reply({ data: [{ index: 0, embedding: [] }] }));
    await expect(embedTexts(openai, ['a'])).rejects.toThrow();
  });

  it('no texts, no request; OpenAI without a key is refused before any request', async () => {
    expect(await embedTexts(openai, [])).toEqual([]);
    await expect(embedTexts({ ...openai, apiKey: '' }, ['x'])).rejects.toThrow(/key/i);
    expect(llmFetch).not.toHaveBeenCalled();
    expect(EMBED_BATCH).toBeGreaterThan(1);
  });
});

describe('embedQuery', () => {
  it('remembers a question, per model', async () => {
    llmFetch.mockResolvedValue(reply({ data: [{ index: 0, embedding: [1, 2] }] }));
    const a = await embedQuery(lmstudio, 'what is due?');
    const b = await embedQuery(lmstudio, 'what is due?');
    expect(b).toBe(a);
    expect(llmFetch).toHaveBeenCalledTimes(1);
    await embedQuery({ ...lmstudio, model: 'other' }, 'what is due?');
    expect(llmFetch).toHaveBeenCalledTimes(2);
  });
});
