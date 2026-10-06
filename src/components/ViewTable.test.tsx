import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(within(plan).getByRole('img', { name: '✓' })).toBeInTheDocument();
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
