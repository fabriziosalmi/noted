import { test, expect } from './fixtures';

// Remote access (#83): the app starts the MCP server on Streamable HTTP (/mcp) with its token, and serves the older /sse only on request.
const PORT = 38917;
const url = (p: string) => `http://127.0.0.1:${PORT}${p}`;
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } };
const ACCEPT = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };

test('remote access: Streamable HTTP at /mcp with the token; /sse only when the older endpoint is switched on', async ({ noted }) => {
  const { win } = noted;
  await win.addInitScript(port => {
    const raw = localStorage.getItem('noted-storage');
    const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
    j.state = j.state || {};
    j.state.settings = { ...(j.state.settings || {}), mcpSseEnabled: true, mcpSsePort: port, language: 'en' };
    localStorage.setItem('noted-storage', JSON.stringify(j));
  }, PORT);
  await win.reload();
  const token = await win.evaluate(() => (window as unknown as { electronAPI: { getMcpSseToken: () => Promise<string> } }).electronAPI.getMcpSseToken());
  expect(token).toBeTruthy();

  // The server comes up; without the token it answers 401, with it a session starts
  await expect.poll(async () => (await fetch(url('/mcp'), { method: 'POST', headers: ACCEPT, body: JSON.stringify(INIT) }).catch(() => null))?.status, { timeout: 30_000 }).toBe(401);
  const init = await fetch(url('/mcp'), { method: 'POST', headers: { ...ACCEPT, Authorization: `Bearer ${token}` }, body: JSON.stringify(INIT) });
  expect(init.status).toBe(200);
  expect(init.headers.get('mcp-session-id')).toBeTruthy();
  const withHeader = await fetch(url('/mcp'), { method: 'POST', headers: { ...ACCEPT, 'X-MCP-Token': token }, body: JSON.stringify(INIT) });
  expect(withHeader.status).toBe(200);

  // Not from a page of another site, nor with another host name
  expect((await fetch(url('/mcp'), { method: 'POST', headers: { ...ACCEPT, Origin: 'https://evil.example.com', 'X-MCP-Token': token }, body: JSON.stringify(INIT) })).status).toBe(403);

  // The older endpoint is not there until it is asked for in Settings
  expect((await fetch(url('/sse'), { headers: { 'X-MCP-Token': token } })).status).toBe(404);
  await win.getByRole('button', { name: 'Settings' }).click();
  await win.getByRole('tab', { name: 'MCP' }).click();
  await expect(win.getByText(`http://localhost:${PORT}/mcp`)).toBeVisible();
  await win.getByRole('switch', { name: 'Also serve the older SSE endpoint' }).click();
  await expect(win.getByText(`http://localhost:${PORT}/sse`)).toBeVisible();
  await expect.poll(async () => (await fetch(url('/sse'), { signal: AbortSignal.timeout(3000) }).catch(() => null))?.status, { timeout: 30_000 }).toBe(401);
});
