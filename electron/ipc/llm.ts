import { ipcMain } from 'electron';
import { assertFetchAllowed, setConfiguredLlmHosts } from '../llm-guard';

// Proxy LLM HTTP requests from renderer — avoids CORS/CSP issues.
// Hard timeout in main so a slow/hung provider can't hang the renderer.
const LLM_FETCH_TIMEOUT_MS = 60_000;
const LLM_FETCH_MAX_BODY_BYTES = 10 * 1024 * 1024; // cap response size at 10 MB

export function registerLlmHandlers(): void {
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
