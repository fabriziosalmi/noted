import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStore, _resetLinkRewriteForTest } from './useStore';
import { registerLinkUpdateUi } from '../lib/linkUpdateUi';

const original = window.electronAPI;
let api: Record<string, ReturnType<typeof vi.fn>>;
let confirm: ReturnType<typeof vi.fn>;
let notify: ReturnType<typeof vi.fn>;

const mode = (m: 'always' | 'ask' | 'never') => useStore.setState(s => ({ settings: { ...s.settings, linkUpdateMode: m } }));
const note = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });

beforeEach(() => {
  vi.useFakeTimers();
  _resetLinkRewriteForTest();
  confirm = vi.fn().mockResolvedValue(true);
  notify = vi.fn();
  registerLinkUpdateUi({ confirm, notify });
  api = {
    renameNote: vi.fn().mockResolvedValue({ success: true, links: { notes: 2, links: 3, failed: 0 } }),
    moveNote: vi.fn().mockResolvedValue({ success: true, data: 'Archive/Plan.md', links: { notes: 1, links: 1, failed: 0 } }),
    renameFolder: vi.fn().mockResolvedValue({ success: true, links: { notes: 1, links: 2, failed: 0 } }),
    deleteFolder: vi.fn().mockResolvedValue({ success: true, data: { moved: 1, renamed: [] }, links: { notes: 1, links: 1, failed: 0 } }),
    previewLinkRewrite: vi.fn().mockResolvedValue({ success: true, data: { notes: 2, links: 3 } }),
    rewriteLinks: vi.fn().mockResolvedValue({ success: true, data: { notes: 2, links: 3, failed: 0 } }),
    getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }),
    readNote: vi.fn().mockResolvedValue({ success: true, data: '<p>x</p>' }),
  };
  window.electronAPI = { ...original, ...api } as unknown as typeof window.electronAPI;
  useStore.setState({
    activeNoteName: 'Old.md', notes: [note('Old.md')], noteFolders: [{ name: 'F', notes: [note('F/One.md'), note('F/Two.md')] }],
    pinnedNotes: [], customNotesOrder: [], customFoldersOrder: [],
  });
  mode('always');
});
afterEach(() => { vi.useRealTimers(); window.electronAPI = original; registerLinkUpdateUi(null); });

const rename = (from: string, to: string, reopen?: boolean) => useStore.getState().renameNote(from, to, reopen === undefined ? undefined : { reopen });

describe('manual rename', () => {
  it('Always: rewrites links as part of the rename and reports the result', async () => {
    await rename('Old.md', 'New.md');
    expect(api.renameNote).toHaveBeenCalledWith('Old.md', 'New.md', undefined, { updateLinks: true });
    expect(notify).toHaveBeenCalledWith({ notes: 2, links: 3, failed: 0 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Never: leaves links alone and says nothing', async () => {
    mode('never');
    api.renameNote.mockResolvedValue({ success: true });
    await rename('Old.md', 'New.md');
    expect(api.renameNote).toHaveBeenCalledWith('Old.md', 'New.md', undefined, { updateLinks: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it('Ask: previews, asks with the real counts, and follows the answer', async () => {
    mode('ask');
    await rename('Old.md', 'New.md');
    expect(api.previewLinkRewrite).toHaveBeenCalledWith([{ from: 'Old.md', to: 'New.md' }], undefined);
    expect(confirm).toHaveBeenCalledWith({ name: 'Old', notes: 2, links: 3 });
    expect(api.renameNote).toHaveBeenCalledWith('Old.md', 'New.md', undefined, { updateLinks: true });

    confirm.mockResolvedValue(false);
    api.renameNote.mockClear();
    useStore.setState({ activeNoteName: 'Other.md' });
    await rename('Other.md', 'Other2.md');
    expect(api.renameNote).toHaveBeenCalledWith('Other.md', 'Other2.md', undefined, { updateLinks: false });
  });

  it('Ask: does not bother the user when nothing links to the note, or when there is no one to ask', async () => {
    mode('ask');
    api.previewLinkRewrite.mockResolvedValue({ success: true, data: { notes: 0, links: 0 } });
    await rename('Old.md', 'New.md');
    expect(confirm).not.toHaveBeenCalled();
    expect(api.renameNote).toHaveBeenCalledWith('Old.md', 'New.md', undefined, { updateLinks: false });

    registerLinkUpdateUi(null);
    api.previewLinkRewrite.mockResolvedValue({ success: true, data: { notes: 2, links: 3 } });
    useStore.setState({ activeNoteName: 'B.md' });
    await rename('B.md', 'B2.md');
    expect(api.renameNote).toHaveBeenLastCalledWith('B.md', 'B2.md', undefined, { updateLinks: false });
  });

  it('reports partial failure', async () => {
    api.renameNote.mockResolvedValue({ success: true, links: { notes: 1, links: 1, failed: 2 } });
    await rename('Old.md', 'New.md');
    expect(notify).toHaveBeenCalledWith({ notes: 1, links: 1, failed: 2 });
  });
});

describe('move and folder operations', () => {
  it('moveNote passes the destination path and the decision', async () => {
    await useStore.getState().moveNote('Plan.md', 'Archive');
    expect(api.moveNote).toHaveBeenCalledWith('Plan.md', 'Archive', undefined, { updateLinks: true });
    mode('ask');
    await useStore.getState().moveNote('Plan.md', 'Archive');
    expect(api.previewLinkRewrite).toHaveBeenCalledWith([{ from: 'Plan.md', to: 'Archive/Plan.md' }], undefined);
  });

  it('renameFolder previews every note in the folder under its new path', async () => {
    mode('ask');
    await useStore.getState().renameFolder('F', 'G');
    expect(api.previewLinkRewrite).toHaveBeenCalledWith([{ from: 'F/One.md', to: 'G/One.md' }, { from: 'F/Two.md', to: 'G/Two.md' }], undefined);
    expect(api.renameFolder).toHaveBeenCalledWith('F', 'G', undefined, { updateLinks: true });
  });

  it('deleteFolder (notes move to the root) asks about the root names', async () => {
    mode('ask');
    await useStore.getState().deleteFolder('F');
    expect(api.previewLinkRewrite).toHaveBeenCalledWith([{ from: 'F/One.md', to: 'One.md' }, { from: 'F/Two.md', to: 'Two.md' }], undefined);
    expect(api.deleteFolder).toHaveBeenCalledWith('F', undefined, { updateLinks: true });
  });
});

describe('title-driven rename (held back, applied once)', () => {
  it('does not rewrite at each pause; one rewrite from the ORIGINAL name to the FINAL one after a quiet moment', async () => {
    await rename('A.md', 'B.md', false);
    await rename('B.md', 'Bo.md', false);
    await rename('Bo.md', 'Bob.md', false);
    for (const c of api.renameNote.mock.calls) expect(c[3]).toEqual({ updateLinks: false });
    expect(api.rewriteLinks).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_900);
    expect(api.rewriteLinks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(api.rewriteLinks).toHaveBeenCalledTimes(1);
    expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'A.md', to: 'Bob.md' }], undefined);
    expect(notify).toHaveBeenCalledWith({ notes: 2, links: 3, failed: 0 });
  });

  it('each further rename restarts the quiet period', async () => {
    await rename('A.md', 'B.md', false);
    await vi.advanceTimersByTimeAsync(4_000);
    await rename('B.md', 'Bo.md', false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(api.rewriteLinks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'A.md', to: 'Bo.md' }], undefined);
  });

  it('settles immediately when the user opens another note', async () => {
    await rename('A.md', 'B.md', false);
    await useStore.getState().openNote('Elsewhere.md');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'A.md', to: 'B.md' }], undefined);
  });

  it('settles a different note\'s pending rename as soon as another note is retitled', async () => {
    await rename('A.md', 'B.md', false);
    useStore.setState({ activeNoteName: 'X.md' });
    await rename('X.md', 'Y.md', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'A.md', to: 'B.md' }], undefined);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(api.rewriteLinks).toHaveBeenLastCalledWith([{ from: 'X.md', to: 'Y.md' }], undefined);
  });

  it('settles on demand (window blur), and never prompts on quit', async () => {
    mode('ask');
    await rename('A.md', 'B.md', false);
    await useStore.getState().flushPendingLinkRewrite({ quiet: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(api.rewriteLinks).not.toHaveBeenCalled(); // Ask + nobody to ask = leave links

    mode('always');
    await rename('C.md', 'D.md', false);
    await useStore.getState().flushPendingLinkRewrite({ quiet: true });
    expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'C.md', to: 'D.md' }], undefined);
  });

  it('Ask prompts once, when the held-back rewrite settles', async () => {
    mode('ask');
    await rename('A.md', 'B.md', false);
    await rename('B.md', 'Bob.md', false);
    expect(confirm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_100);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({ name: 'A', notes: 2, links: 3 });
    expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'A.md', to: 'Bob.md' }], undefined);
  });

  it('Never: nothing is queued', async () => {
    mode('never');
    await rename('A.md', 'B.md', false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.rewriteLinks).not.toHaveBeenCalled();
  });

  it('skips a chain that ended where it began', async () => {
    await rename('A.md', 'B.md', false);
    await rename('B.md', 'A.md', false);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(api.rewriteLinks).not.toHaveBeenCalled();
  });

  it('skips when a new note has taken the old name meanwhile (links to it now mean that note)', async () => {
    await rename('A.md', 'B.md', false);
    useStore.setState({ notes: [note('A.md'), note('B.md')] }); // a new A.md appeared
    await vi.advanceTimersByTimeAsync(6_000);
    expect(api.rewriteLinks).not.toHaveBeenCalled();
  });
});
