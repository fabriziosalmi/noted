// Reading a streamed chat answer: the wire formats of the providers (Server-Sent Events, or one JSON object per line for
// Ollama), cut into the text the model has produced so far. Pure: text in, text out, no I/O, so each format is tested by
// feeding it the bytes a provider sends, cut at any place.

export type StreamKind = 'openai' | 'anthropic' | 'gemini' | 'ollama';

/** What one message of a stream says. */
export interface StreamStep {
  /** New text, if the message carried some. */
  text?: string;
  /** The model has finished (a terminator, not only the end of the connection). */
  done?: boolean;
  /** The provider said it failed, in the middle of the stream. */
  error?: string;
}

interface SseMessage { event: string | null; data: string }

/**
 * Server-Sent Events: lines `field: value`, a message ends at a blank line, `data:` lines of one message are joined with
 * newlines, a line starting with ":" is a comment. Chunks may end anywhere, even between the \r and the \n of a line end.
 */
export function createSseParser(onMessage: (message: SseMessage) => void): { push(chunk: string): void; flush(): void } {
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0) onMessage({ event, data: data.join('\n') });
    event = null;
    data = [];
  };
  const line = (raw: string) => {
    if (raw === '') { dispatch(); return; }
    if (raw.startsWith(':')) return;
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? '' : raw.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  };

  return {
    push(chunk) {
      buffer += chunk;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c !== '\n' && c !== '\r') continue;
        if (c === '\r' && i === buffer.length - 1) break; // may be the first half of \r\n: wait
        line(buffer.slice(start, i));
        if (c === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    flush() {
      if (buffer) line(buffer.replace(/\r$/, ''));
      buffer = '';
      dispatch();
    },
  };
}

/** One JSON document per line (Ollama). Blank lines are ignored. */
export function createLineParser(onLine: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const text = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (text.trim()) onLine(text);
      }
    },
    flush() {
      const rest = buffer.trim();
      buffer = '';
      if (rest) onLine(rest);
    },
  };
}

const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const message = (v: unknown): string => {
  if (typeof v === 'string') return v;
  const m = (v as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : JSON.stringify(v);
};

// OpenAI, OpenRouter, LM Studio and the OpenAI-compatible servers: `data: {"choices":[{"delta":{"content":"…"}}]}`, then `data: [DONE]`.
function openAiStep(m: SseMessage): StreamStep {
  if (m.data.trim() === '[DONE]') return { done: true };
  const json = parse(m.data) as { error?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[] } | undefined;
  if (!json) return {};
  if (json.error) return { error: message(json.error) };
  const text = str(json.choices?.[0]?.delta?.content);
  return text ? { text } : {};
}

// Anthropic: `event: content_block_delta` with `{"delta":{"type":"text_delta","text":"…"}}`, `message_stop` at the end, `error` in between.
function anthropicStep(m: SseMessage): StreamStep {
  const json = parse(m.data) as { type?: string; delta?: { type?: string; text?: unknown }; error?: unknown } | undefined;
  const type = m.event ?? json?.type;
  if (type === 'message_stop') return { done: true };
  if (type === 'error') return { error: message(json?.error ?? m.data) };
  if (type === 'content_block_delta') {
    const text = str(json?.delta?.text);
    if (text) return { text };
  }
  return {};
}

// Gemini (`:streamGenerateContent?alt=sse`): every message is a whole response with the next piece of text; there is no terminator.
function geminiStep(m: SseMessage): StreamStep {
  const json = parse(m.data) as { error?: unknown; candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | undefined;
  if (!json) return {};
  if (json.error) return { error: message(json.error) };
  const text = (json.candidates?.[0]?.content?.parts ?? []).map(p => str(p.text) ?? '').join('');
  return text ? { text } : {};
}

// Ollama: `{"message":{"content":"…"},"done":false}` per line, the last with `"done":true`.
function ollamaStep(line: string): StreamStep {
  const json = parse(line) as { error?: unknown; message?: { content?: unknown }; done?: unknown } | undefined;
  if (!json) return {};
  if (json.error) return { error: message(json.error) };
  const text = str(json.message?.content);
  return { ...(text ? { text } : {}), ...(json.done === true ? { done: true } : {}) };
}

/** Feeds the bytes of a stream in, calls back for each step. After `done` or `error` nothing more is reported. */
export function createStreamReader(kind: StreamKind, onStep: (step: StreamStep) => void): { push(chunk: string): void; flush(): void } {
  let finished = false;
  const emit = (step: StreamStep) => {
    if (finished || (!step.text && !step.done && !step.error)) return;
    if (step.done || step.error) finished = true;
    onStep(step);
  };
  if (kind === 'ollama') {
    const lines = createLineParser(line => emit(ollamaStep(line)));
    return { push: c => lines.push(c), flush: () => lines.flush() };
  }
  const step = kind === 'openai' ? openAiStep : kind === 'anthropic' ? anthropicStep : geminiStep;
  const sse = createSseParser(m => emit(step(m)));
  return { push: c => sse.push(c), flush: () => sse.flush() };
}
