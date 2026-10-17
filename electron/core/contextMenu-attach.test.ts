// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// Since Electron 44 the clipboard's write methods return a Promise. "Copy Link" runs in the main process, where a
// rejection nobody handles is an unhandled rejection: it must be caught and logged.
const writeText = vi.fn();
const built: { label?: string; click?: () => void }[][] = [];
vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent' },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: (t: { label?: string; click?: () => void }[]) => { built.push(t); return { popup: () => undefined }; } },
  clipboard: { writeText: (...a: unknown[]) => writeText(...a) },
  shell: {},
}));
const logEvent = vi.fn();
vi.mock('../structured-log', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { attachContextMenu } from './contextMenu';

function rightClickOnLink(url: string): () => void {
  let handler: ((e: unknown, p: unknown) => void) | undefined;
  const win = { webContents: { on: (_: string, h: typeof handler) => { handler = h; }, session: {} } };
  attachContextMenu(win as never);
  handler!({}, { misspelledWord: '', dictionarySuggestions: [], isEditable: false, selectionText: '', editFlags: {}, linkURL: url });
  const item = built.at(-1)!.find(i => i.label === 'Copy Link');
  return item!.click!;
}

afterEach(() => { built.length = 0; writeText.mockReset(); logEvent.mockReset(); });

describe('Copy Link', () => {
  it('writes the link to the clipboard', async () => {
    writeText.mockResolvedValue(undefined);
    rightClickOnLink('https://example.com/a')();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/a'));
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('a clipboard that refuses the write is logged, not left as an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      writeText.mockRejectedValue(new Error('clipboard busy'));
      rightClickOnLink('https://example.com/b')();
      await vi.waitFor(() => expect(logEvent).toHaveBeenCalledWith('warn', 'copy_link_failed', { error: 'clipboard busy' }));
      await new Promise(r => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
