import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ViewTable } from './ViewTable';
import { useStore } from '../store/useStore';
import { blankView, type View } from '../../shared/views/model';

const note = (name: string, mtimeMs = 1) => ({ name, path: name, stats: { mtimeMs, ctimeMs: mtimeMs, size: 1 } });
const original = window.electronAPI;

beforeEach(() => {
  window.electronAPI = { ...original, saveViews: vi.fn(async (views: View[]) => ({ success: true, data: views })) } as unknown as typeof window.electronAPI;
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en' },
    notes: [note('Work/Plan.md'), note('Work/Ideas.md'), note('Journal.md')],
    frontmatterIndex: {
      'Work/Plan.md': { status: 'open', votes: 3, done: true, tags: ['q4', 'ops'], due: '2026-10-09' },
      'Work/Ideas.md': { status: 'draft', votes: 12, done: false, tags: ['q4'] },
    },
    tagIndex: {},
    vaultIndexSync: { vault: '/v', seq: 1 },
    views: [],
  });
});
afterEach(() => { window.electronAPI = original; });

const table = (view: View) => {
  const open = vi.fn();
  useStore.setState({ views: [view] });
  render(<ViewTable view={view} onOpenNote={open} />);
  return open;
};
const rowNames = () => screen.getAllByRole('row').slice(1).map(r => r.getAttribute('data-row'));

describe('ViewTable', () => {
  it('one row per note of the source, the name first, the chosen fields as columns', () => {
    table(blankView('v', 'Work', { source: { kind: 'folder', folder: 'Work' }, columns: ['status', 'votes', 'done', 'tags'], sort: [{ field: '$name', dir: 'asc' }] }));
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'status', 'votes', 'done', 'tags']);
    expect(rowNames()).toEqual(['Work/Ideas.md', 'Work/Plan.md']);
    const plan = screen.getByText('Plan').closest('tr') as HTMLElement;
    expect(within(plan).getByText('open')).toBeInTheDocument();
    expect(within(plan).getByText('3').closest('td')).toHaveClass('text-right'); // numbers line up on the right
    expect(within(plan).getByRole('checkbox', { name: 'done' })).toBeChecked();
    expect(within(plan).getByText('q4')).toBeInTheDocument();
    expect(within(plan).getByText('ops')).toBeInTheDocument();
  });

  it('without chosen columns it shows the fields most notes have', () => {
    table(blankView('v', 'All'));
    const heads = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(heads[0]).toBe('Name');
    expect(heads).toEqual(expect.arrayContaining(['status', 'votes', 'done', 'tags']));
  });

  it('the name opens the note', () => {
    const open = table(blankView('v', 'All', { columns: ['status'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    expect(open).toHaveBeenCalledWith('Journal.md');
  });

  it('a header sorts: ascending, descending, then not at all, and says so to assistive technology', () => {
    const view = blankView('v', 'All', { columns: ['votes'] });
    table(view);
    const votes = () => screen.getByRole('columnheader', { name: /votes/ });
    expect(votes()).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(votes()).getByRole('button'));
    expect(useStore.getState().views[0].sort).toEqual([{ field: 'votes', dir: 'asc' }]);
  });

  it('shows the order the view asks for, notes with no value last', () => {
    table(blankView('v', 'All', { columns: ['votes'], sort: [{ field: 'votes', dir: 'desc' }] }));
    expect(rowNames()).toEqual(['Work/Ideas.md', 'Work/Plan.md', 'Journal.md']);
    expect(screen.getByRole('columnheader', { name: /votes/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('says so when no note matches, and while the notes are still being indexed', () => {
    const { unmount } = render(<ViewTable view={blankView('v', 'None', { source: { kind: 'folder', folder: 'Nowhere' } })} onOpenNote={() => undefined} />);
    expect(screen.getByText('No notes match this view.')).toBeInTheDocument();
    unmount();
    useStore.setState({ vaultIndexSync: null });
    render(<ViewTable view={blankView('v', 'All')} onOpenNote={() => undefined} />);
    expect(screen.getByText('Indexing your notes…')).toBeInTheDocument();
  });
});

describe('editing a cell', () => {
  let setNoteProperty: ReturnType<typeof vi.fn>;
  const notice = vi.fn();
  const editable = (view = blankView('v', 'All', { columns: ['status', 'votes', 'done', 'tags'], sort: [{ field: '$name', dir: 'asc' }] })) => {
    setNoteProperty = vi.fn(async (name: string, key: string, value: unknown) => ({
      success: true, data: { changed: true, fields: { ...(useStore.getState().frontmatterIndex[name] ?? {}), [key]: value } },
    }));
    window.electronAPI = { ...window.electronAPI, setNoteProperty } as unknown as typeof window.electronAPI;
    useStore.setState({ views: [view] });
    render(<ViewTable view={view} onOpenNote={() => undefined} onNotice={notice} />);
  };
  const cellOf = (note: string, field: string) => (document.querySelector(`tr[data-row="${note}"] [data-field="${field}"]`) as HTMLElement);
  const edit = (note: string, field: string, text: string) => {
    fireEvent.doubleClick(cellOf(note, field));
    const input = screen.getByLabelText(field);
    fireEvent.change(input, { target: { value: text } });
    return input;
  };

  it('a double-click opens an editor with the value; Enter writes it to that note, only that property', async () => {
    editable();
    const input = edit('Work/Plan.md', 'status', 'done');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('Work/Plan.md', 'status', 'done', { value: 'open' }, undefined));
    expect(screen.queryByLabelText('status')).toBeNull(); // the editor is gone
  });

  it('Enter on a focused cell opens the editor, and Escape drops what was typed', () => {
    editable();
    fireEvent.keyDown(cellOf('Work/Plan.md', 'status'), { key: 'Enter' });
    const input = screen.getByLabelText('status') as HTMLInputElement;
    expect(input.value).toBe('open');
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(setNoteProperty).not.toHaveBeenCalled();
    expect(cellOf('Work/Plan.md', 'status')).toHaveTextContent('open');
  });

  it('leaving the editor keeps the change, and an unchanged value writes nothing', async () => {
    editable();
    fireEvent.blur(edit('Work/Plan.md', 'status', 'review'));
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledTimes(1));
    fireEvent.blur(edit('Work/Ideas.md', 'status', 'draft'));
    expect(setNoteProperty).toHaveBeenCalledTimes(1);
  });

  it('a number field writes a number, a cleared cell removes the property, a list is split', async () => {
    editable();
    fireEvent.keyDown(edit('Work/Plan.md', 'votes', '41'), { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('Work/Plan.md', 'votes', 41, { value: 3 }, undefined));
    fireEvent.keyDown(edit('Work/Ideas.md', 'status', ''), { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('Work/Ideas.md', 'status', undefined, { value: 'draft' }, undefined));
    fireEvent.keyDown(edit('Work/Plan.md', 'tags', 'q4, ops, new'), { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('Work/Plan.md', 'tags', ['q4', 'ops', 'new'], { value: ['q4', 'ops'] }, undefined));
  });

  it('a checkbox toggles with one click, in the note that has it', async () => {
    editable();
    fireEvent.click(within(screen.getByText('Plan').closest('tr') as HTMLElement).getByRole('checkbox'));
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('Work/Plan.md', 'done', false, { value: true }, undefined));
    fireEvent.click(within(screen.getByText('Journal').closest('tr') as HTMLElement).getByRole('checkbox'));
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('Journal.md', 'done', true, { value: undefined }, undefined));
  });

  it('says so when the note changed elsewhere, or the write failed, and shows what the file holds', async () => {
    editable();
    setNoteProperty.mockResolvedValueOnce({ success: false, error: 'changed', conflict: true, fields: { status: 'review' } });
    fireEvent.keyDown(edit('Work/Plan.md', 'status', 'done'), { key: 'Enter' });
    await waitFor(() => expect(notice).toHaveBeenCalledWith('This property was changed elsewhere; the current value is shown.', 'error'));
    expect(cellOf('Work/Plan.md', 'status')).toHaveTextContent('review');
    setNoteProperty.mockResolvedValueOnce({ success: false, error: 'the properties are not valid YAML' });
    fireEvent.keyDown(edit('Work/Ideas.md', 'status', 'x'), { key: 'Enter' });
    await waitFor(() => expect(notice).toHaveBeenLastCalledWith('Could not change the property: the properties are not valid YAML', 'error'));
  });

  it('the name and modified columns are not editable', () => {
    editable(blankView('v', 'All', { columns: ['$modified'] }));
    fireEvent.doubleClick(screen.getByText('Plan'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
