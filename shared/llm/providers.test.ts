import { describe, expect, it } from 'vitest';
import { COMPAT_PRESETS, presetById, presetForUrl } from './providers';
import { parseModelList } from './models';
import { assertFetchAllowed } from '../../electron/llm-guard';

describe('the preset list', () => {
  it('has distinct ids, labels and addresses, so an address names one service', () => {
    for (const key of ['id', 'label', 'baseUrl'] as const) expect(new Set(COMPAT_PRESETS.map((p) => p[key].toLowerCase())).size).toBe(COMPAT_PRESETS.length);
  });

  it('keeps a service on https and a local server on http at this machine, never the other way round', () => {
    for (const p of COMPAT_PRESETS) {
      const u = new URL(p.baseUrl);
      if (p.local) expect([u.protocol, u.hostname]).toEqual(['http:', 'localhost']);
      else expect(u.protocol).toBe('https:');
      expect(p.baseUrl.endsWith('/')).toBe(false);
    }
  });

  it('names no model: a model name in a label or address is a version that goes stale', () => {
    for (const p of COMPAT_PRESETS) expect(`${p.label} ${p.baseUrl}`).not.toMatch(/gpt-|claude-|gemini-|mixtral|qwen|llama-?\d/i);
  });

  it('only offers a service the app is allowed to reach: otherwise choosing it would fail on the first request', () => {
    for (const p of COMPAT_PRESETS.filter((x) => !x.local)) expect(() => assertFetchAllowed(`${p.baseUrl}/chat/completions`), p.label).not.toThrow();
  });

  it('finds the preset from an address, ignoring case and a trailing slash, and nothing for another address', () => {
    expect(presetForUrl('https://API.groq.com/openai/v1/')?.id).toBe('groq');
    expect(presetForUrl(' http://localhost:8888/v1 ')?.id).toBe('unsloth');
    expect(presetForUrl('https://example.test/v1')).toBeUndefined();
    expect(presetForUrl('')).toBeUndefined();
    expect(presetForUrl(undefined)).toBeUndefined();
    expect(presetById('vllm')?.baseUrl).toBe('http://localhost:8000/v1');
  });
});

describe('reading a list of models', () => {
  it('reads each service\'s shape, sorted, without duplicates', () => {
    expect(parseModelList('openrouter', { data: [{ id: 'b/x' }, { id: 'a/y' }, { id: 'b/x' }] })).toEqual(['a/y', 'b/x']);
    expect(parseModelList('anthropic', { data: [{ id: 'm2', display_name: 'M2' }, { id: 'm1' }] })).toEqual(['m1', 'm2']);
    expect(parseModelList('ollama', { models: [{ name: 'z:1b' }, { name: 'a:7b' }] })).toEqual(['a:7b', 'z:1b']);
    expect(parseModelList('openai-compatible', { data: [{ id: 'one' }] })).toEqual(['one']);
  });

  it('gives Gemini\'s names without the "models/" prefix, only those that generate text', () => {
    expect(parseModelList('gemini', { models: [
      { name: 'models/chatty', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/embedder', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/unlisted' },
    ] })).toEqual(['chatty', 'unlisted']);
  });

  it('leaves out what OpenAI serves that is not for chat', () => {
    const data = ['chat-a', 'text-embedding-x', 'whisper-1', 'tts-1', 'dall-e-3', 'omni-moderation-x', 'chat-b'].map((id) => ({ id }));
    expect(parseModelList('openai', { data })).toEqual(['chat-a', 'chat-b']);
  });

  it('returns an empty list, not an error, for anything unexpected', () => {
    for (const body of [null, undefined, 42, 'x', {}, { data: 'no' }, { data: [null, 1, {}, { id: 3 }] }, { models: {} }]) {
      for (const kind of ['openai', 'anthropic', 'gemini', 'openrouter', 'openai-compatible', 'ollama'] as const) expect(parseModelList(kind, body)).toEqual([]);
    }
  });
});
