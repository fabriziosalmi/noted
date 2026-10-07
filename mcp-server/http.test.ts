// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Streamable HTTP (#83), end to end over a real socket with the SDK's own client, plus the security checks of the older endpoint
// carried over: token, Host, Origin, 127.0.0.1.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
let server: http.Server;
let port: number;
const argv = process.argv;
const TOKEN = 'supersecret-token';

const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };

async function start(options: { authToken?: string; legacySse?: boolean } = {}): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-http-')));
  fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  server = http.createServer(mcp.createHttpListener({ authToken: options.authToken, legacySse: options.legacySse ?? false }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
}
afterEach(async () => {
  process.argv = argv;
  await new Promise<void>(resolve => { server?.closeAllConnections?.(); server?.close(() => resolve()); });
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A raw request, so headers the HTTP client would refuse to set (Host) can be sent. */
function raw(method: string, urlPath: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } };
const ACCEPT = { Accept: 'application/json, text/event-stream' };

async function connectClient(headers: Record<string, string> = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'test-client', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers } }));
  return client;
}

describe('Streamable HTTP at /mcp', () => {
  beforeEach(() => start());

  it('a real client connects, lists the tools, calls one, lists and reads notes as resources', async () => {
    write('Plan.md', '# Plan\n\ntext\n');
    const client = await connectClient();
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(expect.arrayContaining(['read_note', 'edit_note', 'query_notes']));
    const res = await client.callTool({ name: 'read_note', arguments: { name: 'Plan.md' } });
    expect(JSON.stringify(res.content)).toContain('text');
    expect((await client.listResources()).resources.map(r => r.uri)).toEqual(['noted://note/Plan.md']);
    const read = await client.readResource({ uri: 'noted://note/Plan.md' });
    expect(read.contents[0]).toMatchObject({ text: '# Plan\n\ntext\n' });
    await client.close();
  });

  it('each connection is its own session: two clients at once get their own answers, and a write is journaled under its own session and client name', async () => {
    const a = await connectClient();
    const b = await connectClient();
    await Promise.all([
      a.callTool({ name: 'create_note', arguments: { name: 'a.md', content: 'from a' } }),
      b.callTool({ name: 'create_note', arguments: { name: 'b.md', content: 'from b' } }),
    ]);
    expect(fs.existsSync(p('a.md')) && fs.existsSync(p('b.md'))).toBe(true);
    const { readEntries } = await import('../shared/vault/journalFile');
    const entries = readEntries(dir).entries;
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.client === 'test-client')).toBe(true);
    expect(new Set(entries.map(e => e.session)).size).toBe(2);
    expect(entries.every(e => e.session.startsWith('http-'))).toBe(true);
    await a.close();
    await b.close();
  });

  it('a request without a session is refused unless it starts one; an unknown session is not found; DELETE ends one', async () => {
    expect((await raw('POST', '/mcp', ACCEPT, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(400);
    expect((await raw('POST', '/mcp', { ...ACCEPT, 'mcp-session-id': 'nope' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(404);
    expect((await raw('GET', '/mcp', ACCEPT)).status).toBe(400);
    expect((await raw('GET', '/mcp', { ...ACCEPT, 'mcp-session-id': 'nope' })).status).toBe(404);
    const init = await raw('POST', '/mcp', ACCEPT, INIT);
    expect(init.status).toBe(200);
    const sid = init.headers['mcp-session-id'] as string;
    expect(sid).toBeTruthy();
    expect((await raw('DELETE', '/mcp', { 'mcp-session-id': sid })).status).toBe(200);
    expect((await raw('POST', '/mcp', { ...ACCEPT, 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 3, method: 'tools/list' })).status).toBe(404);
  });

  it('refuses a body that is not JSON, and one that is too large', async () => {
    const bad = await new Promise<number>(resolve => {
      const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { ...ACCEPT, 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.end('{ not json');
    });
    expect(bad).toBe(400);
  });

  it('the older SSE endpoints are not there unless asked for, and nothing else is', async () => {
    expect((await raw('GET', '/sse', ACCEPT)).status).toBe(404);
    expect((await raw('POST', '/messages?sessionId=x', ACCEPT, INIT)).status).toBe(404);
    expect((await raw('GET', '/anything')).status).toBe(404);
    expect((await raw('PUT', '/mcp', ACCEPT)).status).toBe(405);
  });
});

describe('the checks every request passes', () => {
  beforeEach(() => start({ authToken: TOKEN }));

  it('no token, a wrong token, a token in the query: 401; the header or a Bearer token: through', async () => {
    expect((await raw('POST', '/mcp', ACCEPT, INIT)).status).toBe(401);
    expect((await raw('POST', '/mcp', { ...ACCEPT, 'X-MCP-Token': 'wrong-token-xx' }, INIT)).status).toBe(401);
    expect((await raw('POST', '/mcp', { ...ACCEPT, Authorization: 'Bearer wrong' }, INIT)).status).toBe(401);
    expect((await raw('POST', `/mcp?token=${TOKEN}`, ACCEPT, INIT)).status).toBe(401); // a URL ends up in logs: not accepted for /mcp
    expect((await raw('POST', '/mcp', { ...ACCEPT, 'X-MCP-Token': TOKEN }, INIT)).status).toBe(200);
    expect((await raw('POST', '/mcp', { ...ACCEPT, Authorization: `Bearer ${TOKEN}` }, INIT)).status).toBe(200);
  });

  it('a session id alone does not get in: every message needs the token', async () => {
    const init = await raw('POST', '/mcp', { ...ACCEPT, Authorization: `Bearer ${TOKEN}` }, INIT);
    const sid = init.headers['mcp-session-id'] as string;
    expect((await raw('POST', '/mcp', { ...ACCEPT, 'mcp-session-id': sid }, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401);
    expect((await raw('GET', '/mcp', { ...ACCEPT, 'mcp-session-id': sid })).status).toBe(401);
    expect((await raw('DELETE', '/mcp', { 'mcp-session-id': sid })).status).toBe(401);
  });

  it('a client with the token in its headers works end to end', async () => {
    write('a.md', '# A\n');
    const client = await connectClient({ Authorization: `Bearer ${TOKEN}` });
    expect((await client.listResources()).resources).toHaveLength(1);
    await client.close();
    await expect(connectClient({})).rejects.toThrow();
  });

  it('a Host or an Origin that is not local is refused before the token is looked at (DNS rebinding)', async () => {
    expect((await raw('POST', '/mcp', { ...ACCEPT, Host: 'evil.example.com', 'X-MCP-Token': TOKEN }, INIT)).status).toBe(403);
    expect((await raw('POST', '/mcp', { ...ACCEPT, Origin: 'https://evil.example.com', 'X-MCP-Token': TOKEN }, INIT)).status).toBe(403);
    expect((await raw('POST', '/mcp', { ...ACCEPT, Host: 'localhost:3000', Origin: 'http://localhost:5173', 'X-MCP-Token': TOKEN }, INIT)).status).toBe(200);
    expect((await raw('POST', '/mcp', { ...ACCEPT, Host: '[::1]:3000', 'X-MCP-Token': TOKEN }, INIT)).status).toBe(200);
  });

  it('preflight is answered for a local origin only, with the headers a Streamable client needs, and never a wildcard', async () => {
    const ok = await raw('OPTIONS', '/mcp', { Origin: 'http://localhost:5173', Host: 'localhost:3000' });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(ok.headers['access-control-allow-headers'])).toMatch(/Authorization.*Mcp-Session-Id/i);
    expect(ok.headers['access-control-expose-headers']).toBe('Mcp-Session-Id');
    expect((await raw('OPTIONS', '/mcp', { Origin: 'https://evil.example.com' })).status).toBe(403);
  });
});

describe('the older SSE endpoint, behind its flag', () => {
  beforeEach(() => start({ authToken: TOKEN, legacySse: true }));

  it('is served, with the token in the header or the query as before, and still refuses what it refused', async () => {
    expect((await raw('GET', '/sse', ACCEPT)).status).toBe(401);
    expect((await raw('POST', '/messages?sessionId=nope', { 'X-MCP-Token': TOKEN }, INIT)).status).toBe(404);
    expect((await raw('POST', '/messages', { 'X-MCP-Token': TOKEN }, INIT)).status).toBe(400);
    expect((await raw('GET', '/sse', { Host: 'evil.example.com' })).status).toBe(403);
  });

  it('a client of the older kind still connects and calls a tool', async () => {
    write('Old.md', '# Old\n');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const client = new Client({ name: 'old-client', version: '1' });
    await client.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`), { requestInit: { headers: { 'X-MCP-Token': TOKEN } }, eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), 'X-MCP-Token': TOKEN } }) } }));
    expect((await client.listResources()).resources.map(r => r.uri)).toEqual(['noted://note/Old.md']);
    await client.close();
  });
});

describe('prompts over the wire (#77)', () => {
  it('a client sees the prompts capability, lists the prompts of the vault, and gets one filled in', async () => {
    await start();
    write('prompts/Make formal.md', '---\nname: Formal tone\nscope: selection\ndescription: Rewrite formally\n---\nRewrite formally:\n\n{{selection}}\n');
    const client = await connectClient();
    try {
      expect(client.getServerCapabilities()).toMatchObject({ prompts: {} });
      const listed = await client.listPrompts();
      expect(listed.prompts).toEqual([{ name: 'make-formal', title: 'Formal tone', description: 'Rewrite formally', arguments: [{ name: 'selection', description: 'The text to work on', required: true }] }]);
      const got = await client.getPrompt({ name: 'make-formal', arguments: { selection: 'hello' } });
      expect(got.messages[0]).toMatchObject({ role: 'user', content: { type: 'text', text: 'Rewrite formally:\n\nhello' } });
      await expect(client.getPrompt({ name: 'make-formal', arguments: {} })).rejects.toThrow(/selection/);
    } finally {
      await client.close();
    }
  });
});

