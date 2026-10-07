// The list of models a service offers, read from its answer to "which models do you have?". Pure: the request is in src/lib/llm.ts.
// Nothing here knows a model's name: a person picks from what the service itself says today.

export type ModelListKind = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'openai-compatible' | 'ollama';

// OpenAI answers with everything it serves, speech and images included; those are not models to chat with.
const NOT_CHAT = /(embed|whisper|tts|transcribe|dall-e|moderation|image|audio|realtime|search-preview|davinci|babbage|computer-use)/i;

const ids = (list: unknown, key: string): string[] =>
  Array.isArray(list) ? list.map((m) => (m as Record<string, unknown>)?.[key]).filter((v): v is string => typeof v === 'string' && v !== '') : [];

/** Model names, sorted, from a service's JSON answer. Anything unexpected gives an empty list, never an error. */
export function parseModelList(kind: ModelListKind, body: unknown): string[] {
  const o = (body ?? {}) as Record<string, unknown>;
  let names: string[];
  switch (kind) {
    case 'gemini':
      // "models/<name>", and only those that can generate text
      names = (Array.isArray(o.models) ? o.models : [])
        .filter((m) => {
          const methods = (m as { supportedGenerationMethods?: unknown })?.supportedGenerationMethods;
          return !Array.isArray(methods) || methods.includes('generateContent');
        })
        .map((m) => (m as { name?: unknown })?.name)
        .filter((v): v is string => typeof v === 'string')
        .map((n) => n.replace(/^models\//, ''));
      break;
    case 'ollama':
      names = ids(o.models, 'name');
      break;
    case 'openai':
      names = ids(o.data, 'id').filter((id) => !NOT_CHAT.test(id));
      break;
    default: // anthropic, openrouter and every OpenAI-compatible server: { data: [{ id }] }
      names = ids(o.data, 'id');
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
