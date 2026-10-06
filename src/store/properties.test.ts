import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStore } from './useStore';

const original = window.electronAPI;
const s = () => useStore.getState();
let api: ReturnType<typeof vi.fn>;

beforeEach(() => {
  api = vi.fn();
  window.electronAPI = { ...original, setNoteProperty: api } as unknown as typeof window.electronAPI;
  useStore.setState({ frontmatterIndex: { 'a.md': { status: 'open', votes: 3 } } });
});
afterEach(() => { window.electronAPI = original; });

describe('setNoteProperty in the store', () => {
  it('shows the new value at once, asks the file to change only if it still holds what was shown, and settles on the file', async () => {
    let shownDuring: unknown;
    api.mockImplementation(async () => {
      shownDuring = s().frontmatterIndex['a.md'];
      return { success: true, data: { changed: true, fields: { status: 'done', votes: 3 } } };
    });
    const result = await s().setNoteProperty('a.md', 'status', 'done');
    expect(result).toEqual({ ok: true });
    expect(shownDuring).toEqual({ status: 'done', votes: 3 });
    expect(api).toHaveBeenCalledWith('a.md', 'status', 'done', { value: 'open' }, undefined);
    expect(s().frontmatterIndex['a.md']).toEqual({ status: 'done', votes: 3 });
  });

  it('removing sends undefined, and a note left with no properties leaves the index', async () => {
    api.mockResolvedValue({ success: true, data: { changed: true, fields: { votes: 3 } } });
    await s().setNoteProperty('a.md', 'status', undefined);
    expect(api).toHaveBeenCalledWith('a.md', 'status', undefined, { value: 'open' }, undefined);
    api.mockResolvedValue({ success: true, data: { changed: true, fields: {} } });
    await s().setNoteProperty('a.md', 'votes', undefined);
    expect(s().frontmatterIndex['a.md']).toBeUndefined();
  });

  it('a conflict settles on what the file holds and says so', async () => {
    api.mockResolvedValue({ success: false, error: 'changed', conflict: true, fields: { status: 'review', votes: 3 } });
    expect(await s().setNoteProperty('a.md', 'status', 'done')).toEqual({ ok: false, conflict: true, error: 'changed' });
    expect(s().frontmatterIndex['a.md']).toEqual({ status: 'review', votes: 3 });
  });

  it('a failure puts the old value back', async () => {
    api.mockResolvedValue({ success: false, error: 'the properties are not valid YAML' });
    expect(await s().setNoteProperty('a.md', 'status', 'done')).toEqual({ ok: false, conflict: false, error: 'the properties are not valid YAML' });
    expect(s().frontmatterIndex['a.md']).toEqual({ status: 'open', votes: 3 });
    api.mockRejectedValue(new Error('ipc down'));
    expect((await s().setNoteProperty('a.md', 'status', 'done')).ok).toBe(false);
    expect(s().frontmatterIndex['a.md']).toEqual({ status: 'open', votes: 3 });
  });

  it('a note that had no properties gets an entry', async () => {
    api.mockResolvedValue({ success: true, data: { changed: true, fields: { status: 'new' } } });
    await s().setNoteProperty('b.md', 'status', 'new');
    expect(api).toHaveBeenCalledWith('b.md', 'status', 'new', { value: undefined }, undefined);
    expect(s().frontmatterIndex['b.md']).toEqual({ status: 'new' });
  });
});
