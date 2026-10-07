import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askLLM, streamLLM, AbortedError, LlmHttpError } from './llm';
import { createMasker } from './piiMasker';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

type Provider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'openai-compatible' | 'lmstudio' | 'ollama';
const use = (llmProvider: Provider, over: Record<string, unknown> = {}) => useStore.setState({
  settings: {
    ...useStore.getState().settings, llmProvider, llmApiKey: llmProvider === 'ollama' || llmProvider === 'lmstudio' ? '' : 'k',
    llmModel: 'some-model', lmStudioUrl: 'http://localhost:1234/v1', openaiCompatibleUrl: 'https://llm.example.com/v1', piiMasking: true, language: 'en', ...over,
  },
});

const enc = new TextEncoder();
/** A response that delivers the given text in the given pieces. */
function streamed(pieces: string[], status = 200): Response {
  let i = 0;
  return new Response(new ReadableStream({
    pull(controller) { if (i < pieces.length) controller.enqueue(enc.encode(pieces[i++])); else controller.close(); },
  }), { status });
}
const sse = (...data: unknown[]) => data.map(d => `data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`).join('');
const delta = (content: string) => ({ choices: [{ delta: { content } }] });
const chunksOf = (text: string, size: number) => text.match(new RegExp(`[^]{1,${size}}`, 'g')) ?? [];

beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { window.electronAPI = original; });

describe('streamLLM over fetch (browser)', () => {
  beforeEach(() => { window.electronAPI = { ...original, llmStreamStart: undefined, onLlmStream: undefined } as unknown as typeof window.electronAPI; });

  it('hands over the text as it arrives, and returns all of it', async () => {
    use('openai');
    fetchMock.mockResolvedValueOnce(streamed([sse(delta('Hel')), sse(delta('lo')) + sse('[DONE]')]));
    const seen: string[] = [];
    expect(await streamLLM([{ role: 'user', content: 'hi' }], { onText: t => seen.push(t) })).toBe('Hello');
    expect(seen).toEqual(['Hel', 'lo']);
  });

  it('each provider asks for the stream with the request of its one-shot call, plus the stream flag', async () => {
    const messages = [{ role: 'system' as const, content: 'be brief' }, { role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'yes' }, { role: 'user' as const, content: 'more' }];
    const providers: Provider[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'openai-compatible', 'lmstudio', 'ollama'];
    for (const provider of providers) {
      use(provider);
      fetchMock.mockReset();
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }], content: [{ text: 'x' }], candidates: [{ content: { parts: [{ text: 'x' }] } }], message: { content: 'x' } }) });
      await askLLM(messages);
      const [oneUrl, one] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];

      fetchMock.mockReset();
      fetchMock.mockResolvedValue(streamed([]));
      await streamLLM(messages).catch(() => undefined); // an empty stream is an error; only the request matters here
      const [streamUrl, stream] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string; method: string }];

      const url = provider === 'gemini' ? oneUrl.replace(':generateContent', ':streamGenerateContent?alt=sse') : oneUrl;
      expect(streamUrl, provider).toBe(url);
      expect(stream.method).toBe('POST');
      expect(stream.headers, provider).toEqual(one.headers);
      const body = JSON.parse(stream.body) as Record<string, unknown>;
      if (provider === 'gemini') expect(body.stream).toBeUndefined(); else expect(body.stream).toBe(true);
      delete body.stream;
      const oneBody = JSON.parse(one.body) as Record<string, unknown>;
      expect(oneBody.stream ?? false).toBe(false); // the one-shot request never asks for a stream (Ollama says so: stream: false)
      delete oneBody.stream;
      expect(body, provider).toEqual(oneBody);
    }
  });

  it('reads every provider format', async () => {
    const cases: [Provider, string[], string][] = [
      ['anthropic', [`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } })}\n\n`, `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'B' } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`], 'AB'],
      ['gemini', [sse({ candidates: [{ content: { parts: [{ text: 'C' }] } }] }), sse({ candidates: [{ content: { parts: [{ text: 'D' }] } }] })], 'CD'],
      ['ollama', ['{"message":{"content":"E"},"done":false}\n{"message":{"content', '":"F"},"done":false}\n{"done":true}\n'], 'EF'],
      ['lmstudio', [sse(delta('G'), delta('H'), '[DONE]')], 'GH'],
    ];
    for (const [provider, pieces, want] of cases) {
      use(provider);
      fetchMock.mockResolvedValueOnce(streamed(pieces));
      expect(await streamLLM([{ role: 'user', content: 'hi' }]), provider).toBe(want);
    }
  });

  it('turns an HTTP failure into the typed error the UI already knows, without retrying one that cannot succeed', async () => {
    use('openai');
    fetchMock.mockResolvedValueOnce(new Response('{"error":"bad key"}', { status: 401 }));
    const err = await streamLLM([{ role: 'user', content: 'hi' }]).catch(e => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect((err as LlmHttpError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure while nothing has been shown', async () => {
    use('openai');
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(streamed([sse(delta('ok'), '[DONE]')]));
    expect(await streamLLM([{ role: 'user', content: 'hi' }])).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never starts a half-shown answer over: a failure after text is an error', async () => {
    use('openai');
    fetchMock.mockResolvedValueOnce(streamed([sse(delta('partial')), sse({ error: { message: 'overloaded' } })]));
    const seen: string[] = [];
    await expect(streamLLM([{ role: 'user', content: 'hi' }], { onText: t => seen.push(t) })).rejects.toThrow('overloaded');
    expect(seen).toEqual(['partial']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an answer with no text is the provider-specific error, not an empty string', async () => {
    use('anthropic');
    fetchMock.mockResolvedValueOnce(streamed(['event: message_stop\ndata: {"type":"message_stop"}\n\n']));
    await expect(streamLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/empty|vuota/i);
  });

  it('stopping rejects with AbortedError, keeps what had arrived, and cancels the request', async () => {
    use('openai');
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => {
      let sent = false;
      return Promise.resolve(new Response(new ReadableStream({
        pull(c) {
          if (!sent) { sent = true; c.enqueue(enc.encode(sse(delta('so far')))); return; }
          return new Promise<void>((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
        },
      })));
    });
    const seen: string[] = [];
    const run = streamLLM([{ role: 'user', content: 'hi' }], { signal: controller.signal, onText: t => { seen.push(t); controller.abort(); } });
    await expect(run).rejects.toBeInstanceOf(AbortedError);
    expect(seen.join('')).toBe('so far');
    expect(((fetchMock.mock.calls[0] as unknown[])[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });

  it('a signal that is already aborted makes no request', async () => {
    use('openai');
    const controller = new AbortController();
    controller.abort();
    await expect(streamLLM([{ role: 'user', content: 'hi' }], { signal: controller.signal })).rejects.toBeInstanceOf(AbortedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('streamLLM and masked values', () => {
  beforeEach(() => { window.electronAPI = { ...original, llmStreamStart: undefined, onLlmStream: undefined } as unknown as typeof window.electronAPI; });

  const answer = 'Write to [EMAIL_1] and [EMAIL_2], not [IP_1]. A [link](x) stays.';
  const restored = 'Write to ana@example.com and bob@example.org, not 10.0.0.7. A [link](x) stays.';
  const user = [{ role: 'user' as const, content: 'ana@example.com, bob@example.org, 10.0.0.7' }];

  it('masks what a cloud provider is sent and restores it in the answer, however the answer is cut', async () => {
    use('openai');
    for (const size of [1, 2, 3, 5, 7, 64]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(streamed(chunksOf(answer, size).map(c => sse(delta(c))).concat(sse('[DONE]'))));
      const seen: string[] = [];
      expect(await streamLLM(user, { onText: t => seen.push(t) }), `size ${size}`).toBe(restored);
      expect(seen.join('')).toBe(restored);
      expect(seen.every(t => !/\[(EMAIL|IP)_\d*\]?$/.test(t) || t === '')).toBe(true); // never half a token
      const sent = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as { messages: { content: string }[] };
      expect(sent.messages[0].content).toBe('[EMAIL_1], [EMAIL_2], [IP_1]');
    }
  });

  it('a masker the caller already used is the one that restores', async () => {
    use('ollama'); // local: nothing is masked here, the caller masked it
    const masker = createMasker();
    const masked = masker.mask('ana@example.com');
    fetchMock.mockResolvedValueOnce(streamed(['{"message":{"content":"Hi [EMA"},"done":false}\n{"message":{"content":"IL_1]"},"done":true}\n']));
    expect(await streamLLM([{ role: 'user', content: masked }], { masker })).toBe('Hi ana@example.com');
  });

  it('a local provider with no masker is sent and answered verbatim', async () => {
    use('ollama');
    fetchMock.mockResolvedValueOnce(streamed(['{"message":{"content":"see [EMAIL_1]"},"done":true}\n']));
    expect(await streamLLM([{ role: 'user', content: 'ana@example.com' }])).toBe('see [EMAIL_1]');
    expect((JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as { messages: { content: string }[] }).messages[0].content).toBe('ana@example.com');
  });

  it('askLLM restores masked values in its answer too', async () => {
    use('openai');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'mail [EMAIL_1]' } }] }) });
    expect(await askLLM([{ role: 'user', content: 'ana@example.com' }])).toBe('mail ana@example.com');
  });

  it('turning masking off sends the text as it is', async () => {
    use('openai', { piiMasking: false });
    fetchMock.mockResolvedValueOnce(streamed([sse(delta('ok'), '[DONE]')]));
    await streamLLM([{ role: 'user', content: 'ana@example.com' }]);
    expect((JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as { messages: { content: string }[] }).messages[0].content).toBe('ana@example.com');
  });
});

describe('streamLLM through the main process', () => {
  type Listener = (id: string, event: { text?: string; end?: boolean; error?: string }) => void;
  let listener: Listener | null;
  let start: ReturnType<typeof vi.fn>;
  let abort: ReturnType<typeof vi.fn>;
  const emit = (id: string, event: Parameters<Listener>[1]) => listener!(id, event);
  const idOf = () => (start.mock.calls[start.mock.calls.length - 1] as [string])[0];
  const tick = () => new Promise(r => setTimeout(r, 0));

  beforeEach(() => {
    listener = null;
    start = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    abort = vi.fn();
    window.electronAPI = { ...original, llmStreamStart: start, llmStreamAbort: abort, onLlmStream: (cb: Listener) => { listener = cb; return () => { listener = null; }; } } as unknown as typeof window.electronAPI;
    use('openai');
  });

  it('asks the main process for the request, shows the pieces as they come, and closes the stream when the model is done', async () => {
    const seen: string[] = [];
    const run = streamLLM([{ role: 'user', content: 'hi' }], { onText: t => seen.push(t) });
    await tick();
    const id = idOf();
    expect(start).toHaveBeenCalledWith(id, 'https://api.openai.com/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
    emit(id, { text: sse(delta('He')) });
    emit(id, { text: sse(delta('llo')).slice(0, 10) });
    emit(id, { text: sse(delta('llo')).slice(10) + sse('[DONE]') });
    expect(await run).toBe('Hello');
    expect(seen).toEqual(['He', 'llo']);
    expect(abort).toHaveBeenCalledWith(id); // nothing more to read: the request to the provider is closed
  });

  it('pieces of another stream are not ours', async () => {
    const run = streamLLM([{ role: 'user', content: 'hi' }]);
    await tick();
    emit('someone-else', { text: sse(delta('WRONG')) });
    emit(idOf(), { text: sse(delta('right')), });
    emit(idOf(), { end: true });
    expect(await run).toBe('right');
  });

  it('stopping tells the main process to cancel upstream, and rejects at once', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const run = streamLLM([{ role: 'user', content: 'hi' }], { signal: controller.signal, onText: t => seen.push(t) });
    await tick();
    const id = idOf();
    emit(id, { text: sse(delta('so far')) });
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(AbortedError);
    expect(abort).toHaveBeenCalledWith(id);
    expect(seen).toEqual(['so far']);
    emit(id, { text: sse(delta('late')) }); // anything that still arrives is ignored
    expect(seen).toEqual(['so far']);
  });

  it('a refusal at the start is the typed HTTP error', async () => {
    start.mockResolvedValueOnce({ ok: false, status: 401, text: 'no' });
    await expect(streamLLM([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ name: 'LlmHttpError', status: 401 });
  });

  it('the main process ending the stream with an error is an error', async () => {
    const run = streamLLM([{ role: 'user', content: 'hi' }]);
    await tick();
    emit(idOf(), { text: sse(delta('x')) });
    emit(idOf(), { end: true, error: 'No data for 60s' });
    await expect(run).rejects.toThrow('No data for 60s');
  });
});
