import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, SEED_NOTES } from './fixtures';

// The provider list (Settings → AI Assistant): services and local servers are named in the list, choosing one fills in its address, a
// server on this machine is asked for its models at once (with the key it was given), and no model name is written into the app.
test('providers: presets fill the address, a local server lists its models by itself, a cloud service needs a chosen model', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, 'Anchor.md'), '# Anchor\n\nhello\n');

  let modelsAuth = '';
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      modelsAuth = String(req.headers.authorization ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'served-b' }, { id: 'served-a' }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const { win } = await noted.relaunch();
    await expect(win.getByText('Anchor', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('tab', { name: 'AI', exact: true }).click();
    const provider = win.getByRole('combobox', { name: 'LLM Provider' });

    // The list: named services and servers, grouped, with no model versions in any label
    const labels = await provider.locator('option').allTextContents();
    for (const want of ['OpenAI', 'Anthropic (Claude)', 'Google Gemini', 'OpenRouter', 'Groq', 'Mistral AI', 'DeepSeek', 'Hugging Face', 'LM Studio', 'Ollama', 'Unsloth Studio', 'llama.cpp server', 'vLLM', 'Jan']) expect(labels).toContain(want);
    expect(labels.join(' ')).not.toMatch(/gpt-?4|claude 3|gemini 1|\d\.\d/i);

    // A preset fills in its address
    await provider.selectOption({ label: 'Unsloth Studio' });
    await expect(win.getByLabel('Base URL')).toHaveValue('http://localhost:8888/v1');
    await provider.selectOption({ label: 'Groq' });
    await expect(win.getByLabel('Base URL')).toHaveValue('https://api.groq.com/openai/v1');

    // Your own address, on this machine: its models are listed without being asked, with the key sent along
    await provider.selectOption({ label: 'OpenAI-compatible (your own address)' });
    await win.locator('input[aria-label="API Key"]').pressSequentially('sk-unsloth-test');
    // typed by hand, key by key: the field keeps what was typed, and the key reaches the main process whole
    await expect(win.locator('input[aria-label="API Key"]')).toHaveValue('sk-unsloth-test');
    await expect.poll(() => win.evaluate(async () => ((await (window as unknown as { electronAPI: { getApiKey: () => Promise<{ data?: string }> } }).electronAPI.getApiKey()).data))).toBe('sk-unsloth-test');
    await win.getByLabel('Base URL').fill(`http://127.0.0.1:${port}/v1`);
    const model = win.getByRole('combobox', { name: 'Model' });
    await expect(model.locator('option')).toHaveText(['served-a', 'served-b'], { timeout: 15_000 });
    expect(modelsAuth).toBe('Bearer sk-unsloth-test');

    // A service in the cloud has no model until one is chosen: nothing is assumed
    await provider.selectOption({ label: 'OpenAI' });
    await expect(win.getByRole('textbox', { name: 'Model' })).toHaveValue('');
    await expect(win.getByRole('textbox', { name: 'Model' })).toHaveAttribute('placeholder', 'Model name, as the service writes it');
  } finally {
    server.close();
  }
});
