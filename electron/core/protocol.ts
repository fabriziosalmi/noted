import { protocol, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { resolveDistPath, vaultRelFromPathname } from '../app-protocol';
import { readVaultImage } from '../attachments';
import { getActiveVaultDir, getTargetDir } from './paths';
import { VITE_DEV_SERVER_URL } from './windows';

/** Serve the renderer bundle, and the vault's images, over app://. */
export function registerAppProtocol(): void {
  // Serve renderer assets via app:// — bypasses ES-module-from-file:// issues inside asar
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      // The renderer bundle first; if the request is not a bundle file, it may be an
      // image from the vault (attachments), served under the same confinement rules.
      const filePath = resolveDistPath(process.env.DIST!, url.pathname);
      let data: Buffer | null = null;
      if (filePath) { try { data = await fs.promises.readFile(filePath); } catch { data = null; } }
      if (!data) {
        const rel = vaultRelFromPathname(url.pathname);
        const img = rel ? readVaultImage(getTargetDir(getActiveVaultDir() || undefined), rel) : null;
        if (!img) return new Response('Not Found', { status: 404 });
        return new Response(Buffer.from(img.bytes), {
          headers: { 'Content-Type': img.type.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' },
        });
      }
      const ext = path.extname(filePath ?? '').toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
        '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
        '.ttf': 'font/ttf', '.ico': 'image/x-icon',
      };
      const mime = mimeMap[ext] ?? 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': mime } });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}

/** Content-Security-Policy for every response (strict in production, looser under Vite). */
export function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Strict CSP in production; a looser one in dev, where Vite's HMR client
    // legitimately needs inline/eval + the dev server + its websocket.
    const csp = VITE_DEV_SERVER_URL
      ? "default-src 'self' app: http://localhost:* ws://localhost:*; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' app: http://localhost:*; " +
        "style-src 'self' 'unsafe-inline' app: http://localhost:*; " +
        "img-src 'self' data: https: app:; " +
        "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: app:; " +
        "font-src 'self' data: app:;"
      // Production: the bundle ships only external module scripts (no inline
      // <script>, verified), so dropping 'unsafe-inline' restores a real
      // backstop behind DOMPurify — an injected inline script won't execute
      // even if a sanitizer bypass ships. AI/network egress goes through the
      // main process (llm-fetch), so the renderer needs no wildcard https in
      // connect-src. img-src keeps https for user-embedded remote images.
      : "default-src 'self' app:; " +
        "script-src 'self' app:; " +
        "style-src 'self' 'unsafe-inline' app:; " +
        "img-src 'self' data: https: app:; " +
        "connect-src 'self' http://127.0.0.1:* http://localhost:* app: ws://localhost:* ws://127.0.0.1:*; " +
        "font-src 'self' data: app:;";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });
}
