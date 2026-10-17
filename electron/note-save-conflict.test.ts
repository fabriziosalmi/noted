// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The editor's autosave and another writer (an MCP client, a sync client, git) can both write the open note. A save
// of text read before the other write must not silently replace it: save-note answers `changed`, the renderer keeps the
// other version, and only then saves with force.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-save-conflict-'));
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
beforeAll(async () => {
  process.env.NOTED_NOTES_DIR = vault;
  const { initNotesDir } = await import('./core/paths');
  initNotesDir();
  const { registerNotesHandlers } = await import('./ipc/notes');
  registerNotesHandlers();
  call = (channel, ...args) => handlers.get(channel)!({}, ...args);
});
afterAll(() => { delete process.env.NOTED_NOTES_DIR; fs.rmSync(root, { recursive: true, force: true }); });

const file = (name: string) => path.join(vault, name);
/** Another program writes the note, with a modification time the app has not seen. */
const writeElsewhere = (name: string, text: string) => {
  fs.writeFileSync(file(name), text);
  const later = new Date(Date.now() + 5_000);
  fs.utimesSync(file(name), later, later);
};

describe('save-note', () => {
  it('saves over a note the app read and nothing else touched', async () => {
    fs.writeFileSync(file('A.md'), '<p>one</p>');
    expect((await call('read-note', 'A.md')).data).toBe('<p>one</p>');
    expect(await call('save-note', 'A.md', '<p>two</p>')).toEqual({ success: true });
    expect(await call('save-note', 'A.md', '<p>three</p>')).toEqual({ success: true });
    expect(fs.readFileSync(file('A.md'), 'utf8')).toBe('<p>three</p>');
  });

  it('refuses to save over a version written elsewhere since the app read it, and leaves that version', async () => {
    fs.writeFileSync(file('B.md'), '<p>as opened</p>');
    await call('read-note', 'B.md');
    writeElsewhere('B.md', '<p>written by an agent</p>');
    const res = await call('save-note', 'B.md', '<p>typed in the editor</p>');
    expect(res).toMatchObject({ success: false, code: 'changed' });
    expect(fs.readFileSync(file('B.md'), 'utf8')).toBe('<p>written by an agent</p>');
  });

  it('saves with force once the caller has kept the other version', async () => {
    fs.writeFileSync(file('C.md'), '<p>as opened</p>');
    await call('read-note', 'C.md');
    writeElsewhere('C.md', '<p>elsewhere</p>');
    expect(await call('save-note', 'C.md', '<p>mine</p>', undefined, { force: true })).toEqual({ success: true });
    expect(fs.readFileSync(file('C.md'), 'utf8')).toBe('<p>mine</p>');
    expect(await call('save-note', 'C.md', '<p>mine again</p>')).toEqual({ success: true });
  });

  it('saves a note the app has never read (a new note) without asking', async () => {
    expect(await call('save-note', 'New.md', '<p>new</p>')).toEqual({ success: true });
  });
});
