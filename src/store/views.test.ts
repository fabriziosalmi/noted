import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStore } from './useStore';
import { normalizeViews } from '../../shared/views/model';

const original = window.electronAPI;
const s = () => useStore.getState();
let saved: unknown[][];
let saveViews: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = [];
  // The main process cleans what it is given and returns it; so does this.
  saveViews = vi.fn(async (views: unknown) => {
    const data = normalizeViews({ views }, () => 'x-gen');
    saved.push(data);
    return { success: true, data };
  });
  window.electronAPI = {
    ...original, saveViews, loadViews: vi.fn().mockResolvedValue({ success: true, data: [{ id: 'f', name: 'From file', source: { kind: 'all' }, filters: [], sort: [], columns: [], layout: 'table' }] }),
  } as unknown as typeof window.electronAPI;
  useStore.setState({ views: [] });
});
afterEach(() => { window.electronAPI = original; });

describe('views in the store', () => {
  it('loads what the vault file holds', async () => {
    await s().loadViews();
    expect(s().views.map(v => v.name)).toEqual(['From file']);
  });

  it('creates a view with defaults, saves the list, and rejects an empty name', async () => {
    const view = await s().createView('  Open tasks  ', { layout: 'board', groupBy: 'status' });
    expect(view).toMatchObject({ name: 'Open tasks', layout: 'board', groupBy: 'status', source: { kind: 'all' }, filters: [], columns: [] });
    expect(view!.id).toMatch(/^v-[0-9a-f]{10}$/);
    expect(s().views).toEqual([view]);
    expect(saved.at(-1)).toEqual([view]);
    expect(await s().createView('   ')).toBeNull();
    expect(s().views).toHaveLength(1);
  });

  it('updates a view without changing its id, and ignores an unknown one', async () => {
    const view = (await s().createView('A'))!;
    await s().updateView(view.id, { name: 'Renamed', filters: [{ field: 'status', op: 'equals', value: 'open' }], id: 'hijack' } as never);
    expect(s().views).toHaveLength(1);
    expect(s().views[0]).toMatchObject({ id: view.id, name: 'Renamed', filters: [{ field: 'status', op: 'equals', value: 'open' }] });
    saveViews.mockClear();
    await s().updateView('nope', { name: 'x' });
    expect(saveViews).not.toHaveBeenCalled();
  });

  it('duplicates a view as an independent copy, and deletes one', async () => {
    const view = (await s().createView('A', { columns: ['x'] }))!;
    const copy = (await s().duplicateView(view.id, 'A copy'))!;
    expect(copy.id).not.toBe(view.id);
    expect(copy).toMatchObject({ name: 'A copy', columns: ['x'] });
    await s().updateView(copy.id, { columns: ['y'] });
    expect(s().views.find(v => v.id === view.id)!.columns).toEqual(['x']);
    await s().deleteView(view.id);
    expect(s().views.map(v => v.name)).toEqual(['A copy']);
    expect(saved.at(-1)).toHaveLength(1);
  });

  it('saves one after another, so the file ends with the last list', async () => {
    const order: number[] = [];
    saveViews.mockImplementation(async (views: { name: string }[]) => {
      await new Promise(r => setTimeout(r, views.length === 1 ? 30 : 0)); // the first save is the slow one
      order.push(views.length);
      return { success: true, data: normalizeViews({ views }, () => 'g') };
    });
    const a = s().createView('A');
    const b = s().createView('B');
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
    expect(s().views.map(v => v.name)).toEqual(['A', 'B']);
  });

  it('reports a failed save, and keeps showing the list', async () => {
    saveViews.mockResolvedValue({ success: false, error: 'disk full' });
    expect(await s().createView('A')).toBeNull();
    expect(s().views).toHaveLength(1);
  });
});
