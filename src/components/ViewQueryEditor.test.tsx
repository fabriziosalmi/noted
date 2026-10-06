import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ViewQueryEditor } from './ViewQueryEditor';
import { useStore } from '../store/useStore';
import { blankView, type View } from '../../shared/views/model';

const original = window.electronAPI;
const VIEW = 'v';
beforeEach(() => {
  window.electronAPI = { ...original, saveViews: vi.fn(async (views: View[]) => ({ success: true, data: views })) } as unknown as typeof window.electronAPI;
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en' },
    frontmatterIndex: {
      'a.md': { status: 'open', votes: 3, done: true, due: '2026-10-09', tags: ['x'] },
      'b.md': { status: 'done', votes: 12, done: false, due: '2026-10-01', tags: ['y'] },
      'c.md': { status: 'open', votes: 7 },
    },
    views: [blankView(VIEW, 'V')], activeViewId: VIEW,
  });
});
afterEach(() => { window.electronAPI = original; });

const current = (): View => useStore.getState().views[0];
const show = () => {
  const { rerender } = render(<ViewQueryEditor view={current()} />);
  return () => rerender(<ViewQueryEditor view={current()} />);
};
const row = (kind: 'filter' | 'sort', i = 0) => screen.getByTestId('view-query').querySelector(`[data-${kind}="${i}"]`) as HTMLElement;

describe('ViewQueryEditor: filters', () => {
  it('says so when there are none, and adds an unfinished one that shows every note', async () => {
    const again = show();
    expect(screen.getByText(/No filters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    await waitFor(() => expect(current().filters).toHaveLength(1));
    again();
    expect(current().filters[0]).toEqual({ field: 'status', op: 'equals' }); // the first field, its first test, no value yet
    expect(screen.queryByText(/No filters/)).toBeNull();
  });

  it('offers the tests that suit the field, choices for a select field, and keeps what is typed', async () => {
    useStore.setState({ views: [blankView(VIEW, 'V', { filters: [{ field: 'votes', op: 'equals' }] })] });
    const again = show();
    const f = () => row('filter');
    const ops = within(f()).getAllByRole('combobox')[1];
    expect([...ops.querySelectorAll('option')].map(o => o.textContent)).toEqual(
      ['is', 'is not', 'is greater than', 'is at least', 'is less than', 'is at most', 'is empty', 'is not empty'],
    );
    fireEvent.change(ops, { target: { value: 'gt' } });
    await waitFor(() => expect(current().filters[0].op).toBe('gt'));
    again();
    fireEvent.change(within(f()).getByLabelText('Value'), { target: { value: '5' } });
    await waitFor(() => expect(current().filters[0]).toEqual({ field: 'votes', op: 'gt', value: 5 })); // a number, not '5'
  });

  it('changing the test keeps the value while the new test takes one, and drops it when it does not', async () => {
    useStore.setState({ views: [blankView(VIEW, 'V', { filters: [{ field: 'status', op: 'equals', value: 'open' }] })] });
    const again = show();
    fireEvent.change(within(row('filter')).getAllByRole('combobox')[1], { target: { value: 'not-equals' } });
    await waitFor(() => expect(current().filters[0]).toEqual({ field: 'status', op: 'not-equals', value: 'open' }));
    again();
    fireEvent.change(within(row('filter')).getAllByRole('combobox')[1], { target: { value: 'is-empty' } });
    await waitFor(() => expect(current().filters[0]).toEqual({ field: 'status', op: 'is-empty' }));
  });

  it('a select field offers its values', async () => {
    useStore.setState({ views: [blankView(VIEW, 'V', { filters: [{ field: 'status', op: 'equals' }] })] });
    show();
    const value = within(row('filter')).getByLabelText('Value');
    expect([...value.querySelectorAll('option')].map(o => o.textContent)).toEqual(['', 'open', 'done']);
    fireEvent.change(value, { target: { value: 'done' } });
    await waitFor(() => expect(current().filters[0].value).toBe('done'));
  });

  it('a test that stands alone takes no value, and a checkbox field offers checked / unchecked', () => {
    useStore.setState({ views: [blankView(VIEW, 'V', { filters: [{ field: 'status', op: 'is-empty' }, { field: 'done', op: 'is-true' }] })] });
    show();
    expect(within(row('filter', 0)).queryByLabelText('Value')).toBeNull();
    expect(within(row('filter', 1)).queryByLabelText('Value')).toBeNull();
    const ops = within(row('filter', 1)).getAllByRole('combobox')[1];
    expect([...ops.querySelectorAll('option')].map(o => o.textContent)).toEqual(['is checked', 'is unchecked']);
  });

  it('changing the field moves to a test that suits it and clears the value; removing drops the row', async () => {
    useStore.setState({ views: [blankView(VIEW, 'V', { filters: [{ field: 'votes', op: 'gt', value: 5 }] })] });
    show();
    fireEvent.change(within(row('filter')).getAllByRole('combobox')[0], { target: { value: 'done' } });
    await waitFor(() => expect(current().filters[0]).toEqual({ field: 'done', op: 'is-true' }));
    fireEvent.click(within(row('filter')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(current().filters).toEqual([]));
  });
});

describe('ViewQueryEditor: sort', () => {
  it('adds keys that are not used yet, changes direction, and removes', async () => {
    const again = show();
    expect(screen.getByText(/No sort/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add sort' }));
    await waitFor(() => expect(current().sort).toEqual([{ field: '$name', dir: 'asc' }]));
    again();
    fireEvent.click(screen.getByRole('button', { name: 'Add sort' }));
    await waitFor(() => expect(current().sort).toHaveLength(2));
    expect(current().sort[1].field).not.toBe('$name');
    again();
    fireEvent.change(within(row('sort', 1)).getAllByRole('combobox')[1], { target: { value: 'desc' } });
    await waitFor(() => expect(current().sort[1].dir).toBe('desc'));
    again();
    fireEvent.click(within(row('sort', 0)).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(current().sort).toHaveLength(1));
  });
});
