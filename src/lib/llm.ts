import { useStore } from '../store/useStore';
import { getElectronApi } from './electronApi';
import { createMasker, type PiiMasker } from './piiMasker';
import { createStreamReader, type StreamKind } from './llmStream';
import { translate, type TranslationKey } from './i18n';

/** Localize a key to the current user language — for errors surfaced to the user via toast/chat. */
function tr(key: TranslationKey): string {
  return translate(key, useStore.getState().settings.language);
}

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

/**
 * Map a raw provider failure to a user-friendly, localized message.
 * `lang` defaults to the current user language so every caller is localized;
 * callers may still pass an explicit language.
 */
export function describeLlmError(
  err: unknown,
  lang: string = useStore.getState().settings.language ?? 'en',
): string {
  const L = (key: TranslationKey) => translate(key, lang);
  if (err instanceof AbortedError) {
    return L('errLlmCancelled');
  }
  if (err instanceof LlmHttpError) {
    if (err.status === 401 || err.status === 403) {
      return L('errLlmBadKey');
    }
    if (err.status === 429) {
      return L('errLlmRateLimit');
    }
    if (err.status === 404) {
      return L('errLlmModelNotFound');
    }
    if (err.status >= 500 && err.status < 600) {
      return L('errLlmProviderDown');
    }
    if (err.status === 0) {
      return L('errLlmUnreachable');
    }
    // Surface the upstream message for unhandled statuses.
    return `HTTP ${err.status}: ${err.body.slice(0, 200)}`;
  }
  const msg = (err as Error)?.message ?? String(err);
  if (/timeout|scaduta/i.test(msg)) {
    return L('errLlmTimeoutFriendly');
  }
  if (/network|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return L('errLlmNetwork');
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

  const api = getElectronApi();
  if (api?.llmFetch) {
    // IPC path: can't pass AbortSignal across the bridge today (see audit #5),
    // but we can short-circuit the wait on the renderer side.
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('LLM request timed out (60s timeout)')),
        LLM_TIMEOUT_MS,
      );
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new AbortedError()); }, { once: true });
    });
    const res = await Promise.race([
      api.llmFetch(url, options),
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
  throw lastErr instanceof Error ? lastErr : new Error(tr('errLlmRequestFailed'));
}

// ==========================================
// Model discovery for local providers
// ==========================================

/** localhost, loopback, or a name only this machine or the LAN resolves. */
function isLocalHost(hostPart: string): boolean {
  const host = hostPart.split('/')[0].split(':')[0].toLowerCase();
  return host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1'
    || /^127\./.test(host) || host.endsWith('.local') || host.endsWith('.localhost');
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A local model server speaks plain HTTP and always has. Anything reached over
  // a network should not be downgraded because the scheme was left out: the
  // prompt, the note text and the API key all travel over this.
  return `${isLocalHost(trimmed) ? 'http' : 'https'}://${trimmed}`;
}

export async function fetchAvailableModels(provider: string, baseUrl: string, apiKey?: string): Promise<string[]> {
  try {
    // LM Studio and any OpenAI-compatible endpoint both expose GET {base}/models
    // in the OpenAI schema; the latter needs the bearer key.
    if (provider === 'lmstudio' || provider === 'openai-compatible') {
      const base = normalizeBaseUrl(baseUrl);
      if (!base) return [];
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await apiFetch(`${base}/models`, { method: 'GET', headers, body: '' });
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

/**
 * What leaves the machine, and how the answer comes back. Cloud providers get every message (system prompt included, it can
 * carry RAG context) with PII masked, unless masking was turned off; local providers (LM Studio / Ollama) never leave the
 * machine and are sent verbatim. The masker is the one a caller may already have masked its text with, so that what the
 * model answers about "[EMAIL_1]" is turned back into the address, here, locally, in the answer.
 */
function prepare(messages: ChatMessage[], given?: PiiMasker) {
  const settings = useStore.getState().settings;
  const { llmProvider, llmApiKey, piiMasking } = settings;
  // 'openai-compatible' is a remote endpoint (Regolo et al.) — treat it as cloud
  // so PII masking applies and a missing key is caught early.
  const isCloud = ['openai', 'anthropic', 'gemini', 'openrouter', 'openai-compatible'].includes(llmProvider);
  if (isCloud && !llmApiKey) {
    throw new Error(tr('errApiKeyMissing'));
  }
  const maskHere = isCloud && piiMasking !== false;
  const masker = given ?? (maskHere ? createMasker() : undefined);
  const out = maskHere && masker ? messages.map(m => ({ ...m, content: masker.mask(m.content) })) : messages;
  return { settings, out, masker };
}

async function askRaw(out: ChatMessage[], settings: ReturnType<typeof prepare>['settings'], signal?: AbortSignal): Promise<string> {
  const { llmProvider, llmApiKey, llmModel, lmStudioUrl, openaiCompatibleUrl } = settings;
  try {
    const resolvedModel = await resolveModel(llmProvider, llmModel, lmStudioUrl);
    switch (llmProvider) {
      case 'openai':
        return await fetchOpenAI(out, llmApiKey, resolvedModel || 'gpt-4o', signal);
      case 'anthropic':
        return await fetchAnthropic(out, llmApiKey, resolvedModel || 'claude-3-5-sonnet-20241022', signal);
      case 'gemini':
        return await fetchGemini(out, llmApiKey, resolvedModel || 'gemini-1.5-pro', signal);
      case 'openrouter':
        return await fetchOpenRouter(out, llmApiKey, resolvedModel || 'anthropic/claude-3.5-sonnet', signal);
      case 'openai-compatible':
        return await fetchOpenAICompatible(out, llmApiKey, llmModel?.trim() ?? '', openaiCompatibleUrl, signal);
      case 'lmstudio':
        return await fetchLMStudio(out, lmStudioUrl, resolvedModel, signal);
      case 'ollama':
        return await fetchOllama(out, resolvedModel, signal);
      default:
        throw new Error(tr('errProviderUnsupported'));
    }
  } catch (error: unknown) {
    throw wrapLlmError(error);
  }
}

function wrapLlmError(error: unknown): Error {
  if (error instanceof AbortedError) return error;
  if (error instanceof LlmHttpError) return error; // preserve status for UI classification
  const err = error as Error;
  console.error('LLM Error:', err);
  return new Error(`${tr('errLlmPrefix')}: ${err.message}`, { cause: error });
}

export async function askLLM(messages: ChatMessage[], opts: { signal?: AbortSignal; masker?: PiiMasker } = {}): Promise<string> {
  const { settings, out, masker } = prepare(messages, opts.masker);
  const text = await askRaw(out, settings, opts.signal);
  return masker ? masker.unmask(text) : text;
}

// ==========================================
// Streaming
// ==========================================

interface StreamRequest {
  url: string;
  options: { method: string; headers: Record<string, string>; body: string };
  kind: StreamKind;
  /** What to say when the model finished without producing any text. */
  empty: TranslationKey;
}

/**
 * The request of a streamed answer: the same endpoint, headers and body as the one-shot request of the same provider
 * (llm.test.ts checks that they agree), asking for the answer in pieces.
 */
function streamRequestFor(settings: ReturnType<typeof prepare>['settings'], messages: ChatMessage[], model: string): StreamRequest {
  const { llmProvider, llmApiKey, lmStudioUrl, openaiCompatibleUrl } = settings;
  const post = (url: string, headers: Record<string, string>, body: unknown) =>
    ({ url, options: { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } });
  switch (llmProvider) {
    case 'openai':
      return { ...post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${llmApiKey}` },
        { model: model || 'gpt-4o', messages, temperature: 0.7, stream: true }), kind: 'openai', empty: 'errEmptyRespOpenai' };
    case 'openrouter': {
      const m = model || 'anthropic/claude-3.5-sonnet';
      return { ...post('https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${llmApiKey}`, 'HTTP-Referer': 'http://localhost:8066', 'X-Title': 'Noted App' },
        { model: m, messages: supportsSystemRole(m) ? messages : normalizeForNoSystemRole(messages), temperature: 0.7, stream: true }), kind: 'openai', empty: 'errEmptyRespOpenrouter' };
    }
    case 'lmstudio':
      return { ...post(`${normalizeBaseUrl(lmStudioUrl)}/chat/completions`, {}, { model, messages, temperature: 0.7, stream: true }), kind: 'openai', empty: 'errEmptyRespLmStudio' };
    case 'openai-compatible': {
      const url = normalizeBaseUrl(openaiCompatibleUrl);
      const m = settings.llmModel?.trim() ?? '';
      if (!url) throw new Error(tr('errOpenAICompatUrlMissing'));
      if (!m) throw new Error(tr('errModelRequired'));
      return { ...post(`${url}/chat/completions`, llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : {},
        { model: m, messages: supportsSystemRole(m) ? messages : normalizeForNoSystemRole(messages), temperature: 0.7, stream: true }), kind: 'openai', empty: 'errEmptyRespOpenai' };
    }
    case 'ollama':
      return { ...post('http://localhost:11434/api/chat', {}, { model, messages, stream: true }), kind: 'ollama', empty: 'errEmptyRespOllama' };
    case 'anthropic':
      return { ...post('https://api.anthropic.com/v1/messages',
        { 'x-api-key': llmApiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        { model: model || 'claude-3-5-sonnet-20241022', max_tokens: 4096, system: messages.find(m => m.role === 'system')?.content, messages: messages.filter(m => m.role !== 'system'), stream: true }),
      kind: 'anthropic', empty: 'errEmptyRespAnthropic' };
    case 'gemini': {
      const body: Record<string, unknown> = {
        contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      };
      const system = messages.find(m => m.role === 'system')?.content;
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return { ...post(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-pro'}:streamGenerateContent?alt=sse`, { 'x-goog-api-key': llmApiKey }, body),
        kind: 'gemini', empty: 'errEmptyRespGemini' };
    }
    default:
      throw new Error(tr('errProviderUnsupported'));
  }
}

interface IpcStreamEvent { text?: string; end?: boolean; error?: string }
const ipcStreams = new Map<string, (event: IpcStreamEvent) => void>();
let ipcBoundTo: object | null = null;
let ipcUnbind: (() => void) | null = null;

/** One listener for every stream: the main process names the stream each piece belongs to. */
function bindIpcStreams(api: NonNullable<ReturnType<typeof getElectronApi>>): void {
  if (ipcBoundTo === api) return;
  ipcUnbind?.();
  ipcBoundTo = api;
  ipcUnbind = api.onLlmStream((id, event) => ipcStreams.get(id)?.(event));
}

let streamSeq = 0;
const newStreamId = (): string => `${Date.now().toString(36)}-${(streamSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Through the main process (which makes the request, as it does for every LLM call), until it ends, fails, or is stopped. */
function streamViaIpc(api: NonNullable<ReturnType<typeof getElectronApi>>, req: StreamRequest, signal: AbortSignal | undefined, onText: (text: string) => void): Promise<void> {
  bindIpcStreams(api);
  const id = newStreamId();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      ipcStreams.delete(id);
      signal?.removeEventListener('abort', onAbort);
      api.llmStreamAbort(id); // the provider has nothing more to say, or nobody wants it: close the request (harmless if already closed)
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(new AbortedError());
    const reader = createStreamReader(req.kind, step => {
      if (step.text) onText(step.text);
      if (step.error) finish(new Error(step.error));
      else if (step.done) finish();
    });
    ipcStreams.set(id, event => {
      if (event.text) reader.push(event.text);
      if (event.end) {
        reader.flush();
        finish(event.error ? new Error(event.error) : undefined);
      }
    });
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    api.llmStreamStart(id, req.url, req.options).then(res => {
      if (!res.ok) finish(new LlmHttpError(res.status, res.text ?? ''));
    }, (err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
  });
}

/** In a browser (development), straight from the page; a stream that goes quiet for a minute is cut. */
async function streamViaFetch(req: StreamRequest, signal: AbortSignal | undefined, onText: (text: string) => void): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  let idle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; controller.abort(); }, LLM_TIMEOUT_MS); };
  try {
    arm();
    const res = await fetch(req.url, { ...req.options, signal: controller.signal });
    if (!res.ok) throw new LlmHttpError(res.status, await res.text());
    if (!res.body) throw new Error(tr('errLlmRequestFailed'));
    let finished = false;
    let failure: Error | undefined;
    const reader = createStreamReader(req.kind, step => {
      if (step.text) onText(step.text);
      if (step.error) failure = new Error(step.error);
      if (step.error || step.done) finished = true;
    });
    const source = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    while (!finished) {
      const { value, done } = await source.read();
      if (done) break;
      arm();
      reader.push(decoder.decode(value, { stream: true }));
    }
    if (!finished) { reader.push(decoder.decode()); reader.flush(); }
    else await source.cancel().catch(() => undefined);
    if (failure) throw failure;
  } catch (err) {
    if (signal?.aborted) throw new AbortedError();
    if (timedOut) throw new Error('LLM request timed out (60s timeout)', { cause: err });
    throw err;
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener('abort', stop);
  }
}

/** Retried like a one-shot request, but only while nothing has been shown: a half-written answer is never started over. */
async function streamWithRetry(req: StreamRequest, signal: AbortSignal | undefined, onText: (text: string) => void): Promise<void> {
  const api = getElectronApi();
  let received = false;
  const seen = (text: string) => { received = true; onText(text); };
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new AbortedError();
    try {
      if (api && typeof api.llmStreamStart === 'function' && typeof api.onLlmStream === 'function') await streamViaIpc(api, req, signal, seen);
      else await streamViaFetch(req, signal, seen);
      return;
    } catch (err) {
      const transient = err instanceof LlmHttpError ? (err.status === 0 || RETRYABLE_STATUSES.has(err.status)) : !(err instanceof AbortedError) && /network|fetch failed|ECONN|ENOTFOUND|timed out/i.test((err as Error)?.message ?? '');
      if (received || !transient || attempt >= RETRY_MAX_ATTEMPTS - 1) throw err;
      await sleep(RETRY_BASE_MS * Math.pow(4, attempt) + Math.random() * 200, signal);
    }
  }
}

/**
 * Like askLLM, but the answer arrives as the model writes it: `onText` gets each piece (already with any masked values
 * restored), and the promise resolves with the whole answer. Stopping (the signal) closes the request to the provider and
 * rejects with AbortedError; what had arrived by then was already handed to `onText`.
 */
export async function streamLLM(
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; masker?: PiiMasker; onText?: (text: string) => void } = {},
): Promise<string> {
  const { settings, out, masker } = prepare(messages, opts.masker);
  const unmasker = masker?.streamUnmasker();
  let answer = '';
  const emit = (text: string) => {
    if (!text) return;
    answer += text;
    opts.onText?.(text);
  };
  try {
    const model = await resolveModel(settings.llmProvider, settings.llmModel, settings.lmStudioUrl);
    const req = streamRequestFor(settings, out, model);
    await streamWithRetry(req, opts.signal, piece => emit(unmasker ? unmasker.push(piece) : piece));
    if (unmasker) emit(unmasker.flush());
    if (!answer) throw new Error(tr(req.empty));
    return answer;
  } catch (error: unknown) {
    if (unmasker && error instanceof AbortedError) emit(unmasker.flush()); // what was held back is text like the rest
    throw wrapLlmError(error);
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
      { role: 'user', content: `[System instructions: ${systemMsg.content}]\n\n${rest[0].content}` },
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
  if (!content) throw new Error(tr('errEmptyRespOpenai'));
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
  if (!content) throw new Error(tr('errEmptyRespOpenrouter'));
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
    throw new Error(`LM Studio (${url}): ${res.status === 0 ? tr('errLmStudioUnreachable') : body}`);
  }
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(tr('errEmptyRespLmStudio'));
  return content;
}

/**
 * Generic OpenAI-spec chat endpoint: any provider that speaks
 * POST {base}/chat/completions with the OpenAI schema (Regolo, Groq, Together,
 * a self-hosted gateway, …). The base URL and key come from settings; the host
 * must be allowlisted for fetch (registered from settings.openaiCompatibleUrl).
 */
async function fetchOpenAICompatible(messages: ChatMessage[], apiKey: string, model: string, baseUrl: string, signal?: AbortSignal) {
  const url = normalizeBaseUrl(baseUrl);
  if (!url) throw new Error(tr('errOpenAICompatUrlMissing'));
  if (!model) throw new Error(tr('errModelRequired'));
  // Arbitrary providers may serve models without a system role (gemma/mistral).
  const payload = supportsSystemRole(model) ? messages : normalizeForNoSystemRole(messages);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await apiFetch(`${url}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages: payload, temperature: 0.7 }),
  }, signal);
  if (!res.ok) throw new Error(await res.text());
  const data = JSON.parse(await res.text()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(tr('errEmptyRespOpenai'));
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
    throw new Error(`Ollama: ${res.status === 0 ? tr('errOllamaUnreachable') : body}`);
  }
  const data = JSON.parse(await res.text()) as { message: { content: string } };
  if (!data.message?.content) throw new Error(tr('errEmptyRespOllama'));
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
  if (!text) throw new Error(tr('errEmptyRespAnthropic'));
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
  if (!text) throw new Error(tr('errEmptyRespGemini'));
  return text;
}
