import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, _resetLinkRewriteForTest } from './useStore';

// The editor starts a title sync at every pause in typing and does not wait for it, and the note list is refreshed
// by more than one caller. Both must end where the user ended, whatever order the answers come back in.
const original = window.electronAPI;
const note = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
interface Reply { success: boolean; error?: string }

let disk: string; // the one note's file name, as the main process would see it
let held: (() => void)[];
let api: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  _resetLinkRewriteForTest();
  disk = 'Spoke.md';
  held = [];
  api = {
    // A rename answers only when the test lets it, and fails if the file is not where it is asked to move it from.
    renameNote: vi.fn((from: string, to: string) => new Promise<Reply>(resolve => {
      held.push(() => {
        if (from !== disk) { resolve({ success: false, error: `no ${from}` }); return; }
        disk = to;
        resolve({ success: true });
      });
    })),
    getNotesTree: vi.fn(async () => ({ success: true, data: { rootNotes: [note(disk)], folders: [] } })),
    rewriteLinks: vi.fn().mockResolvedValue({ success: true, data: { notes: 0, links: 0, failed: 0 } }),
  };
  window.electronAPI = { ...original, ...api } as unknown as typeof window.electronAPI;
  useStore.setState(s => ({
    activeNoteName: 'Spoke.md', notes: [note('Spoke.md')], noteFolders: [],
    settings: { ...s.settings, titleFollowsFilename: true, linkUpdateMode: 'never' },
  }));
});
afterEach(() => { window.electronAPI = original; });

/** Let every rename asked so far answer, then let the store carry on. */
const answer = async () => {
  for (let i = 0; i < 20 && held.length === 0; i++) await Promise.resolve();
  while (held.length) { held.shift()!(); await vi.waitFor(() => undefined); }
};

describe('a title typed in several pauses', () => {
  it('a second title while the first rename is still out is applied after it, from the name it produced', async () => {
    const first = useStore.getState().syncActiveNoteTitle('Hub Spoke');
    const second = useStore.getState().syncActiveNoteTitle('Hub spoke Spoke');
    await answer();
    await first;
    await answer();
    await second;
    expect(disk).toBe('Hub spoke Spoke.md');
    expect(useStore.getState().activeNoteName).toBe('Hub spoke Spoke.md');
    expect(api.renameNote.mock.calls.map(c => [c[0], c[1]])).toEqual([
      ['Spoke.md', 'Hub Spoke.md'],
      ['Hub Spoke.md', 'Hub spoke Spoke.md'],
    ]);
  });

  it('a failed rename does not stop the next title', async () => {
    api.renameNote.mockImplementationOnce(async () => ({ success: false, error: 'busy' }));
    await useStore.getState().syncActiveNoteTitle('Hub Spoke');
    const next = useStore.getState().syncActiveNoteTitle('Hub spoke Spoke');
    await answer();
    await next;
    expect(disk).toBe('Hub spoke Spoke.md');
  });
});

describe('the note list', () => {
  it('a listing that comes back after a newer one does not replace it', async () => {
    let older!: (v: unknown) => void;
    api.getNotesTree
      .mockReturnValueOnce(new Promise(r => { older = r; }))
      .mockResolvedValueOnce({ success: true, data: { rootNotes: [note('New.md')], folders: [] } });
    const a = useStore.getState().fetchNotes();
    const b = useStore.getState().fetchNotes();
    await b;
    older({ success: true, data: { rootNotes: [note('Old.md')], folders: [] } });
    await a;
    expect(useStore.getState().notes.map(n => n.name)).toEqual(['New.md']);
    expect(useStore.getState().isLoading).toBe(false);
  });
});
