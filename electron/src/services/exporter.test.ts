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
  state: { savePath: '', suggested: '' },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<{ success: boolean }>) => {
      mock.handlers.set(channel, fn as never);
    },
  },
  dialog: {
    showSaveDialog: async (opts: { defaultPath?: string }) => {
      mock.state.suggested = opts.defaultPath ?? '';
      return { filePath: mock.state.savePath };
    },
  },
  BrowserWindow: class {}, // only referenced by the PDF/print handlers, not exercised here
}));

import { docxSafeImages, exportFileName, registerExporterHandlers } from './exporter';

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

  it('a closed Save dialog is a cancel, not an error, for every format', async () => {
    mock.state.savePath = '';
    for (const channel of ['export-markdown', 'export-html', 'export-docx', 'export-pdf']) {
      const res = await mock.handlers.get(channel)!({}, '<p>x</p>', 'My Note');
      expect(res, channel).toEqual({ success: false, canceled: true });
    }
  });

  it('suggests the note title as the file name, for Markdown and PDF too', async () => {
    mock.state.savePath = '';
    await mock.handlers.get('export-markdown')!({}, '# x', 'Work/Plan: Q4');
    expect(mock.state.suggested).toBe('Plan- Q4.md');
    await mock.handlers.get('export-pdf')!({}, '<p>x</p>', 'Reading list');
    expect(mock.state.suggested).toBe('Reading list.pdf');
    expect(exportFileName(undefined, 'md')).toBe('Note.md');
    expect(exportFileName('  ', 'html')).toBe('Note.html');
  });

  it('export-html writes the title as text, not as markup', async () => {
    mock.state.savePath = path.join(dir, 'title.html');
    const res = await mock.handlers.get('export-html')!({}, '<p>body</p>', '</title><script>alert(1)</script>');
    expect(res.success).toBe(true);
    const written = fs.readFileSync(mock.state.savePath, 'utf-8');
    expect(written).not.toContain('<script>');
    expect(written).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
  });
});

describe('docxSafeImages', () => {
  const b64 = (bytes: number[]) => Buffer.from([...bytes, ...new Array(20).fill(0)]).toString('base64');
  const png = `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])}`;
  const jpeg = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0])}`;
  const icnsAsPng = `data:image/png;base64,${b64([0x69, 0x63, 0x6e, 0x73])}`; // "icns": what loops image-size 1.x

  it('keeps embedded PNG and JPEG images', () => {
    const html = `<p><img src="${png}" alt="chart"><img src="${jpeg}"></p>`;
    expect(docxSafeImages(html)).toBe(html);
  });

  it('drops an image whose bytes are not what its label says, keeping its alt text', () => {
    expect(docxSafeImages(`<p><img src="${icnsAsPng}" alt="a &amp; b <c>"></p>`)).toBe('<p><span>a &amp; b &lt;c&gt;</span></p>');
  });

  it('drops formats outside the safe list and images given by address', () => {
    const heic = `data:image/heic;base64,${b64([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])}`;
    expect(docxSafeImages(`<img src="${heic}"><img src="https://example.com/x.png" alt="remote">`)).toBe('<span>remote</span>');
  });
});
