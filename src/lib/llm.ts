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

/** HTTP status codes worth retrying on. Anything else fails fast. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;

export class AbortedError extends Error {
  constructor() { super('aborted'); this.name = 'AbortedError'; }
}

/** Typed HTTP failure from a provider — carries status so the UI can show
 *  category-specific copy (rate-limit vs auth vs server). */
export class LlmHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'LlmHttpError';
    this.status = status;
    this.body = body;
  }
}

/** Map a raw provider failure to a user-friendly, localized message. */
export function describeLlmError(err: unknown, lang: 'it' | 'en' = 'en'): string {
  const it = lang === 'it';
  if (err instanceof AbortedError) {
    return it ? 'Richiesta annullata' : 'Request cancelled';
  }
  if (err instanceof LlmHttpError) {
    if (err.status === 401 || err.status === 403) {
      return it
        ? 'API key non valida o senza permessi. Controlla le impostazioni.'
        : 'Invalid or unauthorized API key. Check your settings.';
    }
    if (err.status === 429) {
      return it
        ? 'Limite di richieste raggiunto. Attendi qualche minuto o controlla la tua quota.'
        : 'Rate limit reached. Wait a moment or check your quota.';
    }
    if (err.status === 404) {
      return it
        ? 'Modello non trovato. Verifica il nome del modello nelle impostazioni.'
        : 'Model not found. Check the model name in settings.';
    }
    if (err.status >= 500 && err.status < 600) {
      return it
        ? 'Il provider AI è temporaneamente non disponibile. Riprova tra poco.'
        : 'The AI provider is temporarily unavailable. Try again shortly.';
    }
    if (err.status === 0) {
      return it
        ? 'Impossibile raggiungere il provider AI. Verifica la connessione.'
        : 'Cannot reach the AI provider. Check your connection.';
    }
    // Surface the upstream message for unhandled statuses.
    return `HTTP ${err.status}: ${err.body.slice(0, 200)}`;
  }
  const msg = (err as Error)?.message ?? String(err);
  if (/timeout|scaduta/i.test(msg)) {
    return it
      ? 'Timeout: il provider AI non ha risposto in tempo.'
      : 'Timeout: the AI provider did not respond in time.';
  }
  if (/network|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return it
      ? 'Errore di rete. Verifica la connessione.'
      : 'Network error. Check your connection.';
  }
  return msg;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AbortedError()); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new AbortedError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function apiFetchOnce(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
  signal?: AbortSignal,
): Promise<FetchLike> {
  if (signal?.aborted) throw new AbortedError();

  if (window.electronAPI?.llmFetch) {
    // IPC path: can't pass AbortSignal across the bridge today (see audit #5),
    // but we can short-circuit the wait on the renderer side.
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Richiesta LLM scaduta (timeout 60s)')),
        LLM_TIMEOUT_MS,
      );
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new AbortedError()); }, { once: true });
    });
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

  // Browser path: combine the caller's signal with our own timeout signal.
  const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
  const merged = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  return fetch(url, { ...options, signal: merged });
}

async function apiFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
  signal?: AbortSignal,
): Promise<FetchLike> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await apiFetchOnce(url, options, signal);
      // Retry on transient HTTP failures; for non-retryable failures, return
      // the response and let the caller decide.
      if (!res.ok && RETRYABLE_STATUSES.has(res.status) && attempt < RETRY_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_MS * Math.pow(4, attempt) + Math.random() * 200, signal);
        continue;
      }
      return res;
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      if (signal?.aborted) throw new AbortedError();
      lastErr = err;
      // Network-level failure (DNS, refused, timeout) — retry with backoff.
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_MS * Math.pow(4, attempt) + Math.random() * 200, signal);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Richiesta LLM fallita');
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
async function resolveModel(provider: string, llmModel: string | undefined, lmStudioUrl: string): Promise<string> {
  if (llmModel && typeof llmModel === 'string' && llmModel.trim()) return llmModel.trim();
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

export async function askLLM(messages: ChatMessage[], opts: { signal?: AbortSignal } = {}): Promise<string> {
  const settings = useStore.getState().settings;
  const { llmProvider, llmApiKey, llmModel, lmStudioUrl } = settings;
  const { signal } = opts;

  if (['openai', 'anthropic', 'gemini', 'openrouter'].includes(llmProvider) && !llmApiKey) {
    throw new Error('API Key non configurata nelle impostazioni.');
  }

  try {
    const resolvedModel = await resolveModel(llmProvider, llmModel, lmStudioUrl);
    switch (llmProvider) {
      case 'openai':
        return await fetchOpenAI(messages, llmApiKey, resolvedModel || 'gpt-4o', signal);
      case 'anthropic':
        return await fetchAnthropic(messages, llmApiKey, resolvedModel || 'claude-3-5-sonnet-20241022', signal);
      case 'gemini':
        return await fetchGemini(messages, llmApiKey, resolvedModel || 'gemini-1.5-pro', signal);
      case 'openrouter':
        return await fetchOpenRouter(messages, llmApiKey, resolvedModel || 'anthropic/claude-3.5-sonnet', signal);
      case 'lmstudio':
        return await fetchLMStudio(messages, lmStudioUrl, resolvedModel, signal);
      case 'ollama':
        return await fetchOllama(messages, resolvedModel, signal);
      default:
        throw new Error('Provider non supportato');
    }
  } catch (error: unknown) {
    if (error instanceof AbortedError) throw error;
    if (error instanceof LlmHttpError) throw error; // preserve status for UI classification
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

async function fetchOpenAI(messages: ChatMessage[], apiKey: string, model: string, signal?: AbortSignal) {
  const res = await apiFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  }, signal);
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Risposta OpenAI vuota o non valida');
  return content;
}

async function fetchOpenRouter(messages: ChatMessage[], apiKey: string, model: string, signal?: AbortSignal) {
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
  }, signal);
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Risposta OpenRouter vuota o non valida');
  return content;
}

async function fetchLMStudio(messages: ChatMessage[], baseUrl: string, model: string, signal?: AbortSignal) {
  const url = normalizeBaseUrl(baseUrl);
  const res = await apiFetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  }, signal);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LM Studio (${url}): ${res.status === 0 ? 'server non raggiungibile — verifica che LM Studio sia avviato con il server locale attivo' : body}`);
  }
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LM Studio: risposta vuota o non valida');
  return content;
}

async function fetchOllama(messages: ChatMessage[], model: string, signal?: AbortSignal) {
  const res = await apiFetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  }, signal);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama: ${res.status === 0 ? 'server non raggiungibile — verifica che Ollama sia in esecuzione' : body}`);
  }
  const data = JSON.parse(await res.text()) as { message: { content: string } };
  if (!data.message?.content) throw new Error('Ollama: risposta vuota o non valida');
  return data.message.content;
}

async function fetchAnthropic(messages: ChatMessage[], apiKey: string, model: string, signal?: AbortSignal) {
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
  }, signal);
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { content: { text: string }[] };
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Risposta Anthropic vuota o non valida');
  return text;
}

async function fetchGemini(messages: ChatMessage[], apiKey: string, model: string, signal?: AbortSignal) {
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
    },
    signal,
  );
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { candidates: { content: { parts: { text: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Risposta Gemini vuota o non valida');
  return text;
}
