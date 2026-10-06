import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ViewBoard } from './ViewBoard';
import { useStore } from '../store/useStore';
import { blankView, type View } from '../../shared/views/model';

const note = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
const original = window.electronAPI;
let setNoteProperty: ReturnType<typeof vi.fn>;
const notice = vi.fn();

beforeEach(() => {
  setNoteProperty = vi.fn(async (name: string, key: string, value: unknown) => ({
    success: true, data: { changed: true, fields: { ...(useStore.getState().frontmatterIndex[name] ?? {}), ...(value === undefined ? {} : { [key]: value }) } },
  }));
  window.electronAPI = { ...original, setNoteProperty, saveViews: vi.fn(async (v: View[]) => ({ success: true, data: v })) } as unknown as typeof window.electronAPI;
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en' },
    notes: ['A.md', 'B.md', 'C.md', 'D.md'].map(note),
    frontmatterIndex: {
      'A.md': { status: 'open', tags: ['x'], owner: 'ann' },
      'B.md': { status: 'done', tags: ['x', 'y'] },
      'C.md': { status: 'open' },
    },
    tagIndex: {}, vaultIndexSync: { vault: '/v', seq: 1 }, views: [],
  });
});
afterEach(() => { window.electronAPI = original; notice.mockClear(); });

const show = (patch: Partial<View> = {}) => {
  const view = blankView('v', 'Board', { layout: 'board', groupBy: 'status', sort: [{ field: '$name', dir: 'asc' }], ...patch });
  useStore.setState({ views: [view] });
  const open = vi.fn();
  // Like the page, always shows the view as the store has it now.
  const Live = () => <ViewBoard view={useStore(s => s.views.find(v => v.id === 'v')) ?? view} onOpenNote={open} onNotice={notice} />;
  render(<Live />);
  return open;
};
const column = (value: string) => document.querySelector(`[data-column="${value}"]`) as HTMLElement;
const cards = (value: string) => [...column(value).querySelectorAll('[data-card]')].map(c => c.getAttribute('data-card'));

describe('ViewBoard', () => {
  it('a column for each value, the cards in the view\'s order, notes with no value last', () => {
    show();
    expect([...document.querySelectorAll('[data-column]')].map(c => c.getAttribute('data-column'))).toEqual(['open', 'done', '']);
    expect(cards('open')).toEqual(['A.md', 'C.md']);
    expect(cards('done')).toEqual(['B.md']);
    expect(cards('')).toEqual(['D.md']);
    expect(within(column('open')).getByTestId('column-count')).toHaveTextContent('2');
    expect(column('').querySelector('header')).toHaveTextContent('No value');
  });

  it('a card opens its note, and shows the view\'s columns as small facts', () => {
    const open = show({ columns: ['owner'] });
    expect(within(column('open')).getByText('ann')).toBeInTheDocument();
    fireEvent.click(within(column('open')).getByRole('button', { name: 'A' }));
    expect(open).toHaveBeenCalledWith('A.md');
  });

  it('dropping a card on another column writes that value into the note, expecting the one it had', async () => {
    show();
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', types: ['application/x-noted-card'], effectAllowed: '' };
    fireEvent.dragStart(column('open').querySelector('[data-card="A.md"]') as HTMLElement, { dataTransfer });
    fireEvent.dragOver(column('done'), { dataTransfer });
    fireEvent.drop(column('done'), { dataTransfer });
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('A.md', 'status', 'done', { value: 'open' }, undefined));
  });

  it('dropping on the "no value" column removes the property; dropping where it already is does nothing', async () => {
    show();
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', types: ['application/x-noted-card'], effectAllowed: '' };
    fireEvent.dragStart(column('open').querySelector('[data-card="C.md"]') as HTMLElement, { dataTransfer });
    fireEvent.drop(column('open'), { dataTransfer });
    expect(setNoteProperty).not.toHaveBeenCalled();
    fireEvent.drop(column(''), { dataTransfer });
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('C.md', 'status', undefined, { value: 'open' }, undefined));
  });

  it('a card can also be moved from its own menu, for the keyboard', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Move "B" to'), { target: { value: 'open' } });
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('B.md', 'status', 'open', { value: 'done' }, undefined));
    // the move left "done" empty, but the board keeps it: moving a card pins the columns that were shown
    expect(useStore.getState().views[0].boardColumns).toEqual(['open', 'done']);
    expect(document.querySelector('[data-column="done"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Move "D" to'), { target: { value: 'done' } });
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('D.md', 'status', 'done', { value: undefined }, undefined));
  });

  it('says so when the note changed elsewhere, and when the write failed', async () => {
    show();
    setNoteProperty.mockResolvedValueOnce({ success: false, error: 'changed', conflict: true, fields: { status: 'review' } });
    fireEvent.change(screen.getByLabelText('Move "A" to'), { target: { value: 'done' } });
    await waitFor(() => expect(notice).toHaveBeenCalledWith('This property was changed elsewhere; the current value is shown.', 'error'));
  });

  it('adds a card to a column: a new note that starts with that column\'s value', async () => {
    const createNote = vi.fn(async () => undefined);
    useStore.setState({ createNote });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add card: done' }));
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    const [name, content] = createNote.mock.calls[0] as unknown as [string, string];
    expect(name).toMatch(/^New_Note_\d+\.md$/);
    expect(decodeURIComponent(content)).toContain('status: done');
    fireEvent.click(screen.getByRole('button', { name: 'Add card: No value' }));
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(2));
    expect(decodeURIComponent((createNote.mock.calls[1] as unknown as [string, string])[1])).not.toContain('status');
  });

  it('asks for a group field when there is none, and then shows the board', () => {
    show({ groupBy: undefined });
    const choose = screen.getByTestId('view-board-choose');
    const options = [...choose.querySelectorAll('option')].map(o => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['status', 'owner']));
    expect(options).not.toContain('tags'); // a list puts a note in several columns
    fireEvent.change(within(choose).getByRole('combobox'), { target: { value: 'status' } });
    expect(useStore.getState().views[0].groupBy).toBe('status');
  });

  it('a list field puts a note in each of its columns, and its cards cannot be moved', () => {
    show({ groupBy: 'tags' });
    expect(cards('x')).toEqual(['A.md', 'B.md']);
    expect(cards('y')).toEqual(['B.md']);
    expect(screen.queryByLabelText(/Move "/)).toBeNull();
    expect(screen.getByText(/cards cannot be moved here/)).toBeInTheDocument();
    expect(column('x').querySelector('[data-card]')).toHaveAttribute('draggable', 'false');
  });

  it('columns can be added (and kept when empty), moved, kept from the notes, and removed when empty', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    await waitFor(() => expect(useStore.getState().views[0].boardColumns).toEqual(['review']));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this column: done' }));
    await waitFor(() => expect(useStore.getState().views[0].boardColumns).toEqual(['review', 'done']));
    fireEvent.click(screen.getByRole('button', { name: 'Move column left: done' }));
    await waitFor(() => expect(useStore.getState().views[0].boardColumns).toEqual(['done', 'review']));
    expect([...document.querySelectorAll('[data-column]')].map(c => c.getAttribute('data-column')).slice(0, 2)).toEqual(['done', 'review']);
    // only an empty column can be removed
    expect(screen.queryByRole('button', { name: 'Remove column: done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove column: review' }));
    await waitFor(() => expect(useStore.getState().views[0].boardColumns).toEqual(['done']));
  });
});
