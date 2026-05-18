import { useStore } from '../store/useStore';

// ==========================================
// HTTP helper — uses IPC proxy in Electron to bypass CORS/CSP,
// falls back to regular fetch in browser dev mode.
// ==========================================

interface FetchLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

const LLM_TIMEOUT_MS = 60_000;

async function apiFetch(url: string, options: { method: string; headers: Record<string, string>; body: string }): Promise<FetchLike> {
  if (window.electronAPI?.llmFetch) {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Richiesta LLM scaduta (timeout 60s)')), LLM_TIMEOUT_MS)
    );
    const res = await Promise.race([
      window.electronAPI.llmFetch(url, options),
      timeoutPromise,
    ]);
    return {
      ok: res.ok,
      status: res.status,
      text: () => Promise.resolve(res.text),
    };
  }
  return fetch(url, { ...options, signal: AbortSignal.timeout(LLM_TIMEOUT_MS) });
}

// ==========================================
// Model discovery for local providers
// ==========================================

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export async function fetchAvailableModels(provider: string, lmStudioUrl: string): Promise<string[]> {
  try {
    if (provider === 'lmstudio') {
      const base = normalizeBaseUrl(lmStudioUrl);
      const res = await apiFetch(`${base}/models`, { method: 'GET', headers: { 'Content-Type': 'application/json' }, body: '' });
      if (!res.ok) return [];
      const data = JSON.parse(await res.text()) as { data: { id: string }[] };
      return data.data.map(m => m.id);
    }
    if (provider === 'ollama') {
      const res = await apiFetch('http://localhost:11434/api/tags', { method: 'GET', headers: { 'Content-Type': 'application/json' }, body: '' });
      if (!res.ok) return [];
      const data = JSON.parse(await res.text()) as { models: { name: string }[] };
      return data.models.map(m => m.name);
    }
  } catch { /* server not running */ }
  return [];
}

// Auto-resolve model: if llmModel is empty for local providers, fetch and use first available
async function resolveModel(provider: string, llmModel: string, lmStudioUrl: string): Promise<string> {
  if (llmModel.trim()) return llmModel.trim();
  if (provider === 'lmstudio' || provider === 'ollama') {
    const models = await fetchAvailableModels(provider, lmStudioUrl);
    if (models.length > 0) return models[0];
  }
  return provider === 'ollama' ? 'llama3' : 'local-model';
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function askLLM(messages: ChatMessage[]): Promise<string> {
  const settings = useStore.getState().settings;
  const { llmProvider, llmApiKey, llmModel, lmStudioUrl } = settings;

  if (['openai', 'anthropic', 'gemini', 'openrouter'].includes(llmProvider) && !llmApiKey) {
    throw new Error('API Key non configurata nelle impostazioni.');
  }

  try {
    const resolvedModel = await resolveModel(llmProvider, llmModel, lmStudioUrl);
    switch (llmProvider) {
      case 'openai':
        return await fetchOpenAI(messages, llmApiKey, resolvedModel || 'gpt-4o');
      case 'anthropic':
        return await fetchAnthropic(messages, llmApiKey, resolvedModel || 'claude-3-5-sonnet-20241022');
      case 'gemini':
        return await fetchGemini(messages, llmApiKey, resolvedModel || 'gemini-1.5-pro');
      case 'openrouter':
        return await fetchOpenRouter(messages, llmApiKey, resolvedModel || 'anthropic/claude-3.5-sonnet');
      case 'lmstudio':
        return await fetchLMStudio(messages, lmStudioUrl, resolvedModel);
      case 'ollama':
        return await fetchOllama(messages, resolvedModel);
      default:
        throw new Error('Provider non supportato');
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error('LLM Error:', err);
    throw new Error(`Errore LLM: ${err.message}`, { cause: error });
  }
}

// ==========================================
// API Clients
// ==========================================

// Models that don't accept a dedicated 'system' role — prepend as first user message instead
const NO_SYSTEM_ROLE_PATTERNS = [/gemma/i, /mistral.*(7b|8x7b)/i, /phi-/i, /llama-2/i];

function supportsSystemRole(model: string): boolean {
  return !NO_SYSTEM_ROLE_PATTERNS.some(p => p.test(model));
}

function normalizeForNoSystemRole(messages: ChatMessage[]): ChatMessage[] {
  const systemMsg = messages.find(m => m.role === 'system');
  if (!systemMsg) return messages;
  const rest = messages.filter(m => m.role !== 'system');
  // Prepend system content to the first user message, or add a user turn
  if (rest.length > 0 && rest[0].role === 'user') {
    return [
      { role: 'user', content: `[Istruzioni sistema: ${systemMsg.content}]\n\n${rest[0].content}` },
      ...rest.slice(1),
    ];
  }
  return [{ role: 'user', content: systemMsg.content }, ...rest];
}

async function fetchOpenAI(messages: ChatMessage[], apiKey: string, model: string) {
  const res = await apiFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Risposta OpenAI vuota o non valida');
  return content;
}

async function fetchOpenRouter(messages: ChatMessage[], apiKey: string, model: string) {
  const payload = supportsSystemRole(model) ? messages : normalizeForNoSystemRole(messages);
  const res = await apiFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:8066',
      'X-Title': 'Noted App',
    },
    body: JSON.stringify({ model, messages: payload, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Risposta OpenRouter vuota o non valida');
  return content;
}

async function fetchLMStudio(messages: ChatMessage[], baseUrl: string, model: string) {
  const url = normalizeBaseUrl(baseUrl);
  const res = await apiFetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LM Studio (${url}): ${res.status === 0 ? 'server non raggiungibile — verifica che LM Studio sia avviato con il server locale attivo' : body}`);
  }
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LM Studio: risposta vuota o non valida');
  return content;
}

async function fetchOllama(messages: ChatMessage[], model: string) {
  const res = await apiFetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama: ${res.status === 0 ? 'server non raggiungibile — verifica che Ollama sia in esecuzione' : body}`);
  }
  const data = JSON.parse(await res.text()) as { message: { content: string } };
  if (!data.message?.content) throw new Error('Ollama: risposta vuota o non valida');
  return data.message.content;
}

async function fetchAnthropic(messages: ChatMessage[], apiKey: string, model: string) {
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const chatMsgs = messages.filter(m => m.role !== 'system');
  const res = await apiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 4096, system: systemMsg, messages: chatMsgs }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { content: { text: string }[] };
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Risposta Anthropic vuota o non valida');
  return text;
}

async function fetchGemini(messages: ChatMessage[], apiKey: string, model: string) {
  const geminiMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const body: Record<string, unknown> = { contents: geminiMessages };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };

  const res = await apiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { candidates: { content: { parts: { text: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Risposta Gemini vuota o non valida');
  return text;
}
