// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Shared state must be created via vi.hoisted so the vi.mock factory (hoisted
// above the imports) can reference it without a temporal-dead-zone error.
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<{ success: boolean; data?: unknown; error?: string }>>(),
  state: { savePath: '' },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<{ success: boolean }>) => {
      mock.handlers.set(channel, fn as never);
    },
  },
  dialog: { showSaveDialog: async () => ({ filePath: mock.state.savePath }) },
  BrowserWindow: class {}, // only referenced by the PDF/print handlers, not exercised here
}));

import { registerExporterHandlers } from './exporter';

describe('exporter handlers', () => {
  let dir: string;

  beforeEach(() => {
    mock.handlers.clear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-export-'));
    registerExporterHandlers();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('export-html sanitizes script/event-handler payloads before writing', async () => {
    mock.state.savePath = path.join(dir, 'out.html');
    const handler = mock.handlers.get('export-html')!;

    const res = await handler({}, '<p>hello</p><script>alert(1)</script><img src=x onerror="alert(2)">', 'My Note');

    expect(res.success).toBe(true);
    const written = fs.readFileSync(mock.state.savePath, 'utf-8');
    expect(written).not.toContain('<script>');
    expect(written).not.toContain('onerror');
    expect(written).toContain('hello');
    expect(written).toContain('<!DOCTYPE html>');
  });

  it('export-markdown writes raw content and rejects non-strings', async () => {
    mock.state.savePath = path.join(dir, 'out.md');
    const handler = mock.handlers.get('export-markdown')!;

    const ok = await handler({}, '# Title\n\nbody');
    expect(ok.success).toBe(true);
    expect(fs.readFileSync(mock.state.savePath, 'utf-8')).toBe('# Title\n\nbody');

    const bad = await handler({}, 123);
    expect(bad.success).toBe(false);
  });
});
