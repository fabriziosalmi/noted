// The AI services Noted can talk to, apart from the four it speaks natively (OpenAI, Anthropic, Gemini, OpenRouter) and the two it
// discovers (LM Studio, Ollama): every other one speaks the OpenAI chat protocol, so each is only a name and an address. Choosing one
// in Settings fills the address in; nothing here names a model, because models are replaced faster than this list is read.

export interface CompatPreset {
  id: string;
  label: string;
  /** The address the OpenAI protocol is under, without a trailing slash: `/chat/completions` and `/models` follow. */
  baseUrl: string;
  /** Runs on this computer (or is meant to): no key is needed unless the server was set up with one, and nothing leaves the machine. */
  local: boolean;
}

export const COMPAT_PRESETS: readonly CompatPreset[] = [
  // Services (a key from the service's own dashboard)
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', local: false },
  { id: 'mistral', label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', local: false },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', local: false },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', local: false },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', local: false },
  { id: 'fireworks', label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', local: false },
  { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', local: false },
  { id: 'huggingface', label: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', local: false },
  { id: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', local: false },
  // Servers you run yourself, at the address they use unless told otherwise
  { id: 'unsloth', label: 'Unsloth Studio', baseUrl: 'http://localhost:8888/v1', local: true },
  { id: 'llamacpp', label: 'llama.cpp server', baseUrl: 'http://localhost:8080/v1', local: true },
  { id: 'vllm', label: 'vLLM', baseUrl: 'http://localhost:8000/v1', local: true },
  { id: 'jan', label: 'Jan', baseUrl: 'http://localhost:1337/v1', local: true },
];

const clean = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

/** The preset whose address this is, if any (so the choice needs no setting of its own: the address says it). */
export function presetForUrl(url: string | undefined): CompatPreset | undefined {
  const u = clean(url ?? '');
  return u ? COMPAT_PRESETS.find((p) => clean(p.baseUrl) === u) : undefined;
}

export const presetById = (id: string): CompatPreset | undefined => COMPAT_PRESETS.find((p) => p.id === id);
