import { fetchAvailableModels } from './llm';

export interface LocalDetectionResult {
  provider: 'ollama' | 'lmstudio' | null;
  models: string[];
  url?: string;
}

/**
 * Scans local ports to detect active Ollama or LM Studio servers.
 * Resolves with the first responsive provider and its list of models.
 */
export async function detectLocalLLMs(lmStudioUrl = 'http://localhost:1234/v1'): Promise<LocalDetectionResult> {
  // Test LM Studio
  try {
    const lmStudioModels = await fetchAvailableModels('lmstudio', lmStudioUrl);
    if (lmStudioModels && lmStudioModels.length > 0) {
      return {
        provider: 'lmstudio',
        models: lmStudioModels,
        url: lmStudioUrl
      };
    }
  } catch {
    // ignore and continue
  }

  // Test Ollama
  try {
    const ollamaModels = await fetchAvailableModels('ollama', '');
    if (ollamaModels && ollamaModels.length > 0) {
      return {
        provider: 'ollama',
        models: ollamaModels,
        url: 'http://localhost:11434'
      };
    }
  } catch {
    // ignore
  }

  return { provider: null, models: [] };
}
