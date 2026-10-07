import { ipcMain, type WebContents } from 'electron';
import { assertFetchAllowed, setConfiguredLlmHosts } from '../llm-guard';

// Proxy LLM HTTP requests from renderer — avoids CORS/CSP issues.
// Hard timeout in main so a slow/hung provider can't hang the renderer.
const LLM_FETCH_TIMEOUT_MS = 60_000;
const LLM_FETCH_MAX_BODY_BYTES = 10 * 1024 * 1024; // cap response size at 10 MB

// A streamed answer: the request is made here, the text is sent to the renderer as it arrives. The renderer cannot hand an
// AbortSignal across the bridge, so it names the stream and asks for it to be stopped: that cancels the request upstream (the
// provider stops generating, and stops billing), not only the waiting. No total time limit (an answer may take minutes), but a
// stream that goes quiet for LLM_STREAM_IDLE_MS is cut.
const LLM_STREAM_IDLE_MS = 60_000;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const streams = new Map<string, AbortController>();
const streamKey = (sender: WebContents, id: string) => `${sender.id}:${id}`;

interface RequestOptions { method: string; headers: Record<string, string>; body: string }

export function registerLlmHandlers(opts: { streamIdleMs?: number } = {}): void {
  const idleMs = opts.streamIdleMs ?? LLM_STREAM_IDLE_MS;
  ipcMain.handle('llm-stream-start', async (event, id: unknown, url: unknown, options: RequestOptions) => {
    const webContents = event.sender;
    if (typeof id !== 'string' || !id || typeof url !== 'string') return { ok: false, status: 0, text: 'Invalid request' };
    const key = streamKey(webContents, id);
    if (streams.has(key)) return { ok: false, status: 0, text: 'Duplicate stream id' };
    const controller = new AbortController();
    streams.set(key, controller);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(new Error(`No data for ${idleMs / 1000}s`)), idleMs);
    };
    const cleanup = () => { clearTimeout(idle); streams.delete(key); };
    const live = () => !webContents.isDestroyed();
    const reason = (err: unknown): string => {
      const e = err as Error & { name?: string };
      if (controller.signal.aborted && controller.signal.reason instanceof Error) return controller.signal.reason.message;
      return e.name === 'AbortError' ? 'aborted' : e.message;
    };

    try {
      assertFetchAllowed(url);
      arm();
      const res = await fetch(url, { method: options.method, headers: options.headers, body: options.body || undefined, signal: controller.signal });
      if (!res.ok || !res.body) {
        const text = (await res.text().catch(() => '')).slice(0, MAX_ERROR_BODY_BYTES);
        cleanup();
        return { ok: false, status: res.status, text };
      }
      const reader = res.body.getReader();
      // Pumped after the reply below is on its way: the renderer is listening by then.
      void (async () => {
        const decoder = new TextDecoder('utf-8');
        let total = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > LLM_FETCH_MAX_BODY_BYTES) throw new Error('Response exceeded 10 MB cap');
            if (!live()) { controller.abort(); break; }
            arm();
            const text = decoder.decode(value, { stream: true });
            if (text && live()) webContents.send('llm-stream-chunk', id, text);
          }
          const rest = decoder.decode();
          if (rest && live()) webContents.send('llm-stream-chunk', id, rest);
          if (live()) webContents.send('llm-stream-end', id, {});
        } catch (err) {
          reader.cancel().catch(() => undefined);
          if (live()) webContents.send('llm-stream-end', id, { error: reason(err) });
        } finally {
          cleanup();
        }
      })();
      return { ok: true, status: res.status };
    } catch (err) {
      cleanup();
      return { ok: false, status: 0, text: reason(err) };
    }
  });

  ipcMain.on('llm-stream-abort', (event, id: unknown) => {
    if (typeof id === 'string') streams.get(streamKey(event.sender, id))?.abort();
  });

  ipcMain.handle('llm-fetch', async (_, url: string, options: { method: string; headers: Record<string, string>; body: string }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
    try {
      if (typeof url !== 'string') throw new Error('Invalid URL');
      assertFetchAllowed(url);
      const isGet = options.method.toUpperCase() === 'GET';
      const res = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: isGet ? undefined : (options.body || undefined),
        signal: controller.signal,
      });
      // Stream-decode but cap total bytes to avoid OOM if a provider returns
      // an unbounded response (e.g. infinite SSE).
      const reader = res.body?.getReader();
      let text = '';
      if (reader) {
        const decoder = new TextDecoder('utf-8');
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > LLM_FETCH_MAX_BODY_BYTES) {
            await reader.cancel();
            throw new Error('Response exceeded 10 MB cap');
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } else {
        text = await res.text();
      }
      return { ok: res.ok, status: res.status, text };
    } catch (err: unknown) {
      const e = err as Error & { name?: string };
      const msg = e.name === 'AbortError' ? `Timed out after ${LLM_FETCH_TIMEOUT_MS / 1000}s` : e.message;
      return { ok: false, status: 0, text: msg };
    } finally {
      clearTimeout(timer);
    }
  });

  // Hosts of the user's configured local/custom LLM endpoints (reported by the
  // renderer from settings, e.g. a LAN Ollama).
  ipcMain.on('set-llm-hosts', (_e, hosts: unknown) => {
    setConfiguredLlmHosts(hosts);
  });
}
