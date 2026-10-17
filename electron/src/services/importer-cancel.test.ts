// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// A closed file picker is a cancel, said with a flag the renderer checks, not with a word it would have to match in
// every language.
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>());
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => Promise<Record<string, unknown>>) => { handlers.set(channel, fn); } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}));

import { registerImporterHandlers } from './importer';

describe('import handlers', () => {
  it('report a closed picker as canceled, for the vault and for Evernote', async () => {
    registerImporterHandlers({ markDirty: vi.fn() } as never, () => '/tmp/vault');
    for (const channel of ['import-vault', 'import-enex']) {
      expect(await handlers.get(channel)!({}), channel).toEqual({ success: false, canceled: true });
    }
  });
});
