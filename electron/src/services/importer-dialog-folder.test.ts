// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The import pickers open where the previous import of the same kind was picked from.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-import-dialog-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const userData = path.join(root, 'userData');
const vault = path.join(root, 'vault');
const exports = path.join(root, 'Exports');
const source = path.join(exports, 'Old vault');
for (const d of [userData, vault, source]) fs.mkdirSync(d, { recursive: true });

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>());
const asked = vi.hoisted(() => [] as { title?: string; defaultPath?: string }[]);
const answers = vi.hoisted(() => [] as { canceled: boolean; filePaths: string[] }[]);
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => Promise<Record<string, unknown>>) => { handlers.set(channel, fn); } },
  dialog: { showOpenDialog: async (opts: { title?: string; defaultPath?: string }) => { asked.push(opts); return answers.shift() ?? { canceled: true, filePaths: [] }; } },
}));

import { registerImporterHandlers } from './importer';

describe('import pickers', () => {
  it('a vault import opens next time where the last imported folder was', async () => {
    registerImporterHandlers({ markDirty: vi.fn() } as never, () => vault);
    answers.push({ canceled: false, filePaths: [source] });
    await handlers.get('import-vault')!({});
    await handlers.get('import-vault')!({}); // closed this time
    expect(asked.map(a => a.defaultPath)).toEqual([undefined, exports]);
  });

  it('an Evernote import opens next time in the folder of the files picked last', async () => {
    asked.length = 0;
    const enex = path.join(exports, 'notes.enex');
    fs.writeFileSync(enex, '<?xml version="1.0"?><en-export></en-export>');
    answers.push({ canceled: false, filePaths: [enex] });
    await handlers.get('import-enex')!({});
    await handlers.get('import-enex')!({});
    expect(asked.map(a => a.defaultPath)).toEqual([undefined, exports]);
  });
});
