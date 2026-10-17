// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The renderer turns the editor's HTML into the vault's format before it saves, with the format it was told earlier.
// A save prepared before a conversion and arriving after it would write HTML into a Markdown vault (or the reverse):
// save-note checks the format the text was prepared for against the vault's marker, and refuses a mismatch.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-save-format-'));
const vault = path.join(root, 'vault');
fs.mkdirSync(vault, { recursive: true });
type Handler = (event: unknown, ...args: unknown[]) => Promise<{ success: boolean; code?: string; data?: string }>;
const handlers = new Map<string, Handler>();
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: false },
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: {},
  screen: {},
}));

let call: (channel: string, ...args: unknown[]) => ReturnType<Handler>;
let setFormat: (format: 'html' | 'markdown') => void;
beforeAll(async () => {
  process.env.NOTED_NOTES_DIR = vault;
  const { initNotesDir } = await import('./core/paths');
  initNotesDir();
  const { registerNotesHandlers } = await import('./ipc/notes');
  registerNotesHandlers();
  const { writeVaultFormat } = await import('../shared/vault/formatFile');
  setFormat = format => writeVaultFormat(vault, format);
  call = (channel, ...args) => handlers.get(channel)!({}, ...args);
});
afterAll(() => { delete process.env.NOTED_NOTES_DIR; fs.rmSync(root, { recursive: true, force: true }); });

const file = (name: string) => path.join(vault, name);

describe('save-note and the vault format', () => {
  it('refuses text prepared as HTML once the vault is Markdown, and leaves the note as converted', async () => {
    setFormat('markdown');
    fs.writeFileSync(file('A.md'), '# Alpha\n\nShip it.\n');
    const res = await call('save-note', 'A.md', '<h1>Alpha</h1><p>Ship it. typed</p>', undefined, { format: 'html' });
    expect(res).toMatchObject({ success: false, code: 'format-changed' });
    expect(fs.readFileSync(file('A.md'), 'utf8')).toBe('# Alpha\n\nShip it.\n');
  });

  it('refuses text prepared as Markdown once the vault is back to HTML', async () => {
    setFormat('html');
    fs.writeFileSync(file('B.md'), '<p>back</p>');
    const res = await call('save-note', 'B.md', 'back typed\n', undefined, { format: 'markdown' });
    expect(res).toMatchObject({ success: false, code: 'format-changed' });
    expect(fs.readFileSync(file('B.md'), 'utf8')).toBe('<p>back</p>');
  });

  it('saves text prepared in the vault\'s format', async () => {
    setFormat('markdown');
    expect(await call('save-note', 'C.md', '# Gamma\n', undefined, { format: 'markdown' })).toEqual({ success: true });
    expect(fs.readFileSync(file('C.md'), 'utf8')).toBe('# Gamma\n');
  });

  it('saves when the caller does not say (other callers of the channel are unchanged)', async () => {
    setFormat('markdown');
    expect(await call('save-note', 'D.md', '# Delta\n')).toEqual({ success: true });
  });
});
