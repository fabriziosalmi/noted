import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, SEED_NOTES } from './fixtures';

// Citations in the chat (#74), through the real app and a fake OpenAI-compatible model: the answer arrives with [n] markers, they
// become links and chips, and following one opens the note it points to at the section, with the passage marked.
const GARAGE = '# Garage\n\nIntro to the garage.\n\n## Car\n\nThe car needs an oil change before winter, and new tyres in spring.\n\n## Tools\n\nWrench, jack, and a torque gauge.\n';
const DOGS = '# Dogs\n\n## Training\n\nThe dog learns to sit and to stay.\n';

test('citations: the chat cites its sources, and a click opens the note at the cited passage', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.writeFileSync(path.join(noted.vault, 'Garage.md'), GARAGE);
  fs.mkdirSync(path.join(noted.vault, 'Pets'));
  fs.writeFileSync(path.join(noted.vault, 'Pets', 'Dogs.md'), DOGS);

  // The model: reads the numbered sources it was given and cites the one about the car
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    if (!req.url?.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; } // the app also asks which models there are
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const system = (JSON.parse(body || '{}') as { messages?: { role: string; content: string }[] }).messages?.[0]?.content ?? '';
      asked.push(system);
      const n = /\[(\d+)\] Garage › Car/.exec(system)?.[1];
      const answer = n ? `The car needs an oil change before winter [${n}]. The tools are listed too [9].` : 'No idea.';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of answer.match(/.{1,12}/g) ?? []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const { win } = await noted.relaunch();
    await win.addInitScript(p => {
      const raw = localStorage.getItem('noted-storage');
      const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
      j.state = j.state || {};
      j.state.settings = { ...(j.state.settings || {}), language: 'en', llmProvider: 'lmstudio', lmStudioUrl: `http://127.0.0.1:${p}/v1`, llmModel: 'fake', piiMasking: false, embeddingsEnabled: false };
      localStorage.setItem('noted-storage', JSON.stringify(j));
    }, port);
    await win.reload();
    const editor = win.locator('[contenteditable="true"]').first();

    // Open another note, so that the cited one has to be opened
    await win.getByText('Dogs', { exact: true }).first().click();
    await expect(editor.locator('h1')).toHaveText('Dogs');
    await win.getByRole('button', { name: 'Toggle right panel' }).click();
    await win.getByRole('tab', { name: 'AI Assistant' }).click();

    const input = win.getByPlaceholder(/ask something/i);
    await input.fill('when does the car need an oil change');
    await input.press('Enter');

    // The answer arrives with its marker as a link, the invented number is gone, and the source is a chip
    const marker = win.locator('.ai-chat-md a[href^="#cite-"]');
    await expect(marker).toHaveCount(1, { timeout: 30_000 });
    await expect(win.locator('.ai-chat-md').last()).toContainText('The car needs an oil change before winter');
    await expect(win.locator('.ai-chat-md').last()).not.toContainText('[9]');
    const chip = win.getByTestId('ai-sources').getByRole('button');
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText('Garage › Car');
    // What the model was shown: the open note and the sections, numbered, under their places
    expect(asked[0]).toMatch(/\[1\] Dogs[\s\S]*\[\d+\] Garage › Car\nThe car needs an oil change/);

    // Follow the citation: the note opens, at the section, with the passage marked
    await marker.click();
    await expect(editor.locator('h1')).toHaveText('Garage');
    const marked = editor.locator('.cited-passage');
    await expect(marked.first()).toContainText('oil change before winter', { timeout: 10_000 });
    await expect(marked.first()).toBeInViewport();
    // The mark does not stay for ever, and was never a selection to type over
    await expect(marked).toHaveCount(0, { timeout: 15_000 });
    expect(fs.readFileSync(path.join(noted.vault, 'Garage.md'), 'utf8')).toBe(GARAGE);

    // Clicking the chip does the same for the section of the note that is already open
    await editor.locator('h2', { hasText: 'Tools' }).click();
    await chip.click();
    await expect(editor.locator('.cited-passage').first()).toContainText('oil change before winter', { timeout: 10_000 });
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
