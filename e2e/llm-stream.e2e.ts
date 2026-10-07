import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures';

// A streamed answer through the real app: the preload bridge, the main process, and a provider on loopback. The text reaches
// the page piece by piece, and stopping closes the connection to the provider (so it stops generating) instead of only
// ceasing to wait for it.
interface Event { id: string; text?: string; end?: boolean; error?: string }
interface StreamApi {
  llmStreamStart: (id: string, url: string, o: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text?: string }>;
  llmStreamAbort: (id: string) => void;
  onLlmStream: (cb: (id: string, e: Omit<Event, 'id'>) => void) => () => void;
}

test('llm stream: the text arrives in pieces, and stopping closes the provider connection', async ({ noted }) => {
  const sockets = { closed: 0 };
  const server = http.createServer((req, res) => {
    res.on('close', () => { sockets.closed++; });
    if (req.url === '/refuse') { res.writeHead(429); res.end('slow down'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let n = 0;
    const tick = setInterval(() => {
      if (req.url === '/finite' && n === 3) { res.end(`data: [DONE]\n\n`); clearInterval(tick); return; }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `p${n++} ` } }] })}\n\n`);
    }, 40);
    res.on('close', () => clearInterval(tick));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { win } = noted;
    const run = (path: string, stopAfter: number | null) => win.evaluate(async ({ url, stopAfter }) => {
      const api = (window as unknown as { electronAPI: StreamApi }).electronAPI;
      const id = `e2e-${Math.random().toString(36).slice(2)}`;
      const events: Event[] = [];
      let received = '';
      let stopped = false;
      const off = api.onLlmStream((eid, e) => {
        if (eid !== id) return;
        events.push({ id: eid, ...e });
        if (e.text) received += e.text;
        if (stopAfter !== null && !stopped && (received.match(/p\d/g) ?? []).length >= stopAfter) { stopped = true; api.llmStreamAbort(id); }
      });
      const start = await api.llmStreamStart(id, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (start.ok) {
        const t = Date.now();
        while (!events.some(e => e.end) && Date.now() - t < 10_000) await new Promise(r => setTimeout(r, 25));
      }
      off();
      return { start, pieces: events.filter(e => e.text).length, ended: events.some(e => e.end), received };
    }, { url: `${base}${path}`, stopAfter });

    // A stream that ends by itself: several pieces, in order, then the end
    const finite = await run('/finite', null);
    expect(finite.start).toMatchObject({ ok: true, status: 200 });
    expect(finite.pieces).toBeGreaterThan(1);
    expect(finite.received).toMatch(/p0 [\s\S]*p1 [\s\S]*p2 /); // the wire text, in order: the page parses it
    expect(finite.received).toContain('[DONE]');
    expect(finite.ended).toBe(true);

    // Refused: the status and the body, no stream
    expect(await run('/refuse', null)).toMatchObject({ start: { ok: false, status: 429, text: 'slow down' }, pieces: 0, ended: false });

    // Stopped after two pieces: the provider's connection is closed while it still had more to say
    const before = sockets.closed;
    const stopped = await run('/endless', 2);
    expect(stopped.ended).toBe(true);
    expect(stopped.received).toContain('p1 ');
    expect(stopped.received).not.toContain('p9 ');
    await expect.poll(() => sockets.closed, { timeout: 5000 }).toBeGreaterThan(before); // well inside the 60 s idle limit: it was the stop that closed it
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
