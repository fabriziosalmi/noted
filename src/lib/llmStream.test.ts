import { describe, it, expect } from 'vitest';
import { createLineParser, createSseParser, createStreamReader, type StreamKind, type StreamStep } from './llmStream';

const sse = (...messages: { event?: string; data: string }[]) =>
  messages.map(m => `${m.event ? `event: ${m.event}\n` : ''}data: ${m.data}\n\n`).join('');

/** What a reader reports for a stream cut into the given pieces. */
function read(kind: StreamKind, pieces: string[]): StreamStep[] {
  const steps: StreamStep[] = [];
  const reader = createStreamReader(kind, s => steps.push(s));
  pieces.forEach(p => reader.push(p));
  reader.flush();
  return steps;
}
const cutEverywhere = (text: string): string[][] => Array.from({ length: text.length + 1 }, (_, i) => [text.slice(0, i), text.slice(i)]);
const textOf = (steps: StreamStep[]) => steps.map(s => s.text ?? '').join('');

describe('createSseParser', () => {
  const run = (pieces: string[]) => {
    const out: { event: string | null; data: string }[] = [];
    const p = createSseParser(m => out.push(m));
    pieces.forEach(x => p.push(x));
    p.flush();
    return out;
  };

  it('splits messages at blank lines, joins data lines, skips comments, takes the event name', () => {
    expect(run([': keep-alive\nevent: ping\ndata: a\ndata: b\n\ndata:c\n\n'])).toEqual([{ event: 'ping', data: 'a\nb' }, { event: null, data: 'c' }]);
  });

  it('understands \\r\\n and a lone \\r as line ends, even when a chunk ends between them', () => {
    const text = 'data: one\r\n\r\ndata: two\r\rdata: three\n\n';
    const want = [{ event: null, data: 'one' }, { event: null, data: 'two' }, { event: null, data: 'three' }];
    for (const pieces of cutEverywhere(text)) expect(run(pieces)).toEqual(want);
    expect(run([...text])).toEqual(want);
  });

  it('delivers a last message the server did not end with a blank line', () => {
    expect(run(['data: tail'])).toEqual([{ event: null, data: 'tail' }]);
  });
});

describe('createLineParser', () => {
  it('gives whole lines whatever the chunking, skipping blank ones', () => {
    const text = '{"a":1}\n\n{"b":2}\r\n{"c":3}';
    for (const pieces of cutEverywhere(text)) {
      const out: string[] = [];
      const p = createLineParser(l => out.push(l));
      pieces.forEach(x => p.push(x));
      p.flush();
      expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    }
  });
});

describe('createStreamReader', () => {
  const openai = sse(
    { data: JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }) },
    { data: JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }) },
    { data: JSON.stringify({ choices: [{ delta: { content: 'lo, "wörld" 🌍' } }] }) },
    { data: JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) },
    { data: '[DONE]' },
  );

  it('OpenAI-style: the text of each delta, then done, cut anywhere', () => {
    for (const pieces of cutEverywhere(openai)) {
      const steps = read('openai', pieces);
      expect(textOf(steps)).toBe('Hello, "wörld" 🌍');
      expect(steps[steps.length - 1]).toEqual({ done: true });
    }
  });

  it('OpenAI-style: an error object in the stream is an error, and nothing after it counts', () => {
    const steps = read('openai', [sse({ data: JSON.stringify({ choices: [{ delta: { content: 'a' } }] }) }, { data: JSON.stringify({ error: { message: 'overloaded' } }) }, { data: JSON.stringify({ choices: [{ delta: { content: 'late' } }] }) })]);
    expect(steps).toEqual([{ text: 'a' }, { error: 'overloaded' }]);
  });

  it('Anthropic: text_delta blocks, message_stop ends, the other events are ignored', () => {
    const stream = sse(
      { event: 'message_start', data: JSON.stringify({ type: 'message_start', message: {} }) },
      { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', content_block: { type: 'text', text: '' } }) },
      { event: 'ping', data: JSON.stringify({ type: 'ping' }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ciao ' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'mondo' } }) },
      { event: 'message_delta', data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) },
      { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
    );
    for (const pieces of cutEverywhere(stream)) {
      const steps = read('anthropic', pieces);
      expect(textOf(steps)).toBe('Ciao mondo');
      expect(steps[steps.length - 1]).toEqual({ done: true });
    }
    expect(read('anthropic', [sse({ event: 'error', data: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) })])).toEqual([{ error: 'Overloaded' }]);
  });

  it('Gemini: the text of every part of every message, no terminator', () => {
    const stream = sse(
      { data: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'One ' }], role: 'model' } }] }) },
      { data: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'two ' }, { text: 'three' }] }, finishReason: 'STOP' }], usageMetadata: {} }) },
    );
    for (const pieces of cutEverywhere(stream)) expect(textOf(read('gemini', pieces))).toBe('One two three');
    expect(read('gemini', [sse({ data: JSON.stringify({ error: { code: 429, message: 'quota' } }) })])).toEqual([{ error: 'quota' }]);
  });

  it('Ollama: one JSON object per line, the last says done', () => {
    const stream = [{ message: { content: 'Hi' }, done: false }, { message: { content: ' there' }, done: false }, { message: { content: '' }, done: true }].map(o => JSON.stringify(o)).join('\n') + '\n';
    for (const pieces of cutEverywhere(stream)) {
      const steps = read('ollama', pieces);
      expect(textOf(steps)).toBe('Hi there');
      expect(steps[steps.length - 1]).toEqual({ done: true });
    }
    expect(read('ollama', ['{"error":"model not found"}\n'])).toEqual([{ error: 'model not found' }]);
  });

  it('skips a message that is not JSON instead of failing the whole answer', () => {
    expect(textOf(read('openai', ['data: not json\n\n', sse({ data: JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) })]))).toBe('ok');
  });
});
