// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// The streamed LLM request in the main process, against a real local HTTP server: the text reaches the renderer as it
// arrives, a failure is reported without a stream, and stopping really closes the connection to the provider.
type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, fn: Handler) => { handlers.set(c, fn); }, on: (c: string, fn: Handler) => { handlers.set(c, fn); } },
}));

let server: http.Server;
let base: string;
let route: (req: http.IncomingMessage, res: http.ServerResponse) => void;
const sent: [string, string, unknown][] = [];
const sender = { id: 7, isDestroyed: () => false, send: (channel: string, id: string, payload: unknown) => { sent.push([channel, id, payload]); } };
const event = { sender };
const start = (id: string, path = '/') => handlers.get('llm-stream-start')!(event, id, `${base}${path}`, { method: 'POST', headers: {}, body: '{}' }) as Promise<{ ok: boolean; status: number; text?: string }>;
const until = async (cond: () => boolean, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise(r => setTimeout(r, 10)); } };
const ended = (id: string) => sent.some(([c, i]) => c === 'llm-stream-end' && i === id);
const textOf = (id: string) => sent.filter(([c, i]) => c === 'llm-stream-chunk' && i === id).map(([, , p]) => p).join('');

beforeEach(async () => {
  sent.length = 0;
  handlers.clear();
  server = http.createServer((req, res) => route(req, res));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.resetModules();
  (await import('./ipc/llm')).registerLlmHandlers({ streamIdleMs: 300 });
});
afterEach(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });

describe('llm-stream-start', () => {
  it('answers once the provider has, then sends the text in order and says when it ends', async () => {
    route = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      setTimeout(() => { res.write('data: two\n\n'); res.end(); }, 30);
    };
    expect(await start('a')).toEqual({ ok: true, status: 200 });
    await until(() => ended('a'));
    expect(textOf('a')).toBe('data: one\n\ndata: two\n\n');
    expect(sent[sent.length - 1]).toEqual(['llm-stream-end', 'a', {}]);
  });

  it('keeps a character split across chunks whole', async () => {
    const bytes = Buffer.from('data: héllo 🌍\n\n');
    route = (_req, res) => {
      res.writeHead(200);
      res.write(bytes.subarray(0, 8)); // inside the "é"
      setTimeout(() => { res.write(bytes.subarray(8, 17)); }, 20);
      setTimeout(() => { res.end(bytes.subarray(17)); }, 40);
    };
    await start('u');
    await until(() => ended('u'));
    expect(textOf('u')).toBe('data: héllo 🌍\n\n');
  });

  it('reports a refusal with its status and body, and sends no stream', async () => {
    route = (_req, res) => { res.writeHead(429); res.end('{"error":"rate limited"}'); };
    expect(await start('b')).toEqual({ ok: false, status: 429, text: '{"error":"rate limited"}' });
    expect(sent).toEqual([]);
  });

  it('refuses a host that is not an LLM endpoint, and a request that is not one', async () => {
    const blocked = await handlers.get('llm-stream-start')!(event, 'c', 'https://evil.example.com/x', { method: 'POST', headers: {}, body: '' }) as { ok: boolean; text: string };
    expect(blocked.ok).toBe(false);
    expect(blocked.text).toContain('Blocked host');
    expect(await handlers.get('llm-stream-start')!(event, 42, 'x', {})).toMatchObject({ ok: false });
    expect(await handlers.get('llm-stream-start')!(event, '', `${base}/`, {})).toMatchObject({ ok: false });
  });

  it('stopping closes the connection to the provider, not only the waiting', async () => {
    // a long idle limit: only the stop can close this connection
    vi.resetModules();
    (await import('./ipc/llm')).registerLlmHandlers({ streamIdleMs: 60_000 });
    let providerSawClose = false;
    route = (req, res) => {
      res.writeHead(200);
      res.write('data: first\n\n');
      req.on('close', () => { providerSawClose = true; });
      res.on('close', () => { providerSawClose = true; });
    };
    await start('d');
    await until(() => textOf('d').includes('first'));
    expect(providerSawClose).toBe(false);
    handlers.get('llm-stream-abort')!(event, 'd');
    await until(() => providerSawClose, 1500);
    await until(() => ended('d'));
  });

  it('a stream that goes quiet is cut, with the reason', async () => {
    route = (_req, res) => { res.writeHead(200); res.write('data: hi\n\n'); /* then silence */ };
    await start('e');
    await until(() => ended('e'));
    const end = sent.find(([c, i]) => c === 'llm-stream-end' && i === 'e')!;
    expect((end[2] as { error: string }).error).toMatch(/No data for/);
  });

  it('two streams at once stay apart, and an id in use is refused', async () => {
    route = (req, res) => { res.writeHead(200); setTimeout(() => res.end(`data: ${req.url}\n\n`), 40); };
    const [x, y, dup] = await Promise.all([start('x', '/x'), start('y', '/y'), start('x', '/z')]);
    expect([x.ok, y.ok, dup.ok]).toEqual([true, true, false]);
    await until(() => ended('x') && ended('y'));
    expect(textOf('x')).toBe('data: /x\n\n');
    expect(textOf('y')).toBe('data: /y\n\n');
  });
});
