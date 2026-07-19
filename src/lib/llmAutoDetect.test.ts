import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectLocalLLMs } from './llmAutoDetect';
import { fetchAvailableModels } from './llm';

vi.mock('./llm', () => ({
  fetchAvailableModels: vi.fn(),
}));

describe('detectLocalLLMs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect LM Studio if responsive', async () => {
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce(['lm-model-1']);

    const res = await detectLocalLLMs('http://localhost:1234/v1');

    expect(fetchAvailableModels).toHaveBeenCalledWith('lmstudio', 'http://localhost:1234/v1');
    expect(res).toEqual({
      provider: 'lmstudio',
      models: ['lm-model-1'],
      url: 'http://localhost:1234/v1',
    });
  });

  it('should fallback to Ollama if LM Studio fails but Ollama is responsive', async () => {
    vi.mocked(fetchAvailableModels)
      .mockRejectedValueOnce(new Error('LM Studio down'))
      .mockResolvedValueOnce(['ollama-model-1']);

    const res = await detectLocalLLMs('http://localhost:1234/v1');

    expect(fetchAvailableModels).toHaveBeenCalledTimes(2);
    expect(fetchAvailableModels).toHaveBeenNthCalledWith(1, 'lmstudio', 'http://localhost:1234/v1');
    expect(fetchAvailableModels).toHaveBeenNthCalledWith(2, 'ollama', '');
    expect(res).toEqual({
      provider: 'ollama',
      models: ['ollama-model-1'],
      url: 'http://localhost:11434',
    });
  });

  it('should return null provider if both fail', async () => {
    vi.mocked(fetchAvailableModels)
      .mockRejectedValueOnce(new Error('LM Studio down'))
      .mockRejectedValueOnce(new Error('Ollama down'));

    const res = await detectLocalLLMs();

    expect(res).toEqual({
      provider: null,
      models: [],
    });
  });
});
