import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ViewsSection } from './ViewsSection';
import { ConfirmProvider } from './ConfirmProvider';
import { useStore } from '../store/useStore';
import { blankView, type View } from '../../shared/views/model';

const original = window.electronAPI;
beforeEach(() => {
  window.electronAPI = { ...original, saveViews: vi.fn(async (views: View[]) => ({ success: true, data: views })) } as unknown as typeof window.electronAPI;
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en' },
    views: [blankView('a', 'Open tasks'), blankView('b', 'Reading list')], activeViewId: null,
  });
});
afterEach(() => { window.electronAPI = original; });

const renderSection = () => render(<ConfirmProvider><ViewsSection /></ConfirmProvider>);
const dialog = () => screen.getByRole('dialog');

describe('ViewsSection', () => {
  it('lists the views, and opening one marks it', () => {
    renderSection();
    const list = screen.getByTestId('views-section');
    fireEvent.click(within(list).getByRole('button', { name: 'Reading list' }));
    expect(useStore.getState().activeViewId).toBe('b');
  });

  it('offers the workflows board only once the vault has a workflow note, and opening it leaves the other pages', () => {
    const file = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
    useStore.setState({ notes: [file('plain.md')] });
    const { unmount } = renderSection();
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();
    unmount();
    useStore.setState({ notes: [file('plain.md'), file('agents/wf-WF1-demo.md')], tasksOpen: true });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(useStore.getState()).toMatchObject({ workflowsOpen: true, tasksOpen: false, activityOpen: false, activeViewId: null });
    fireEvent.click(screen.getByRole('button', { name: 'Reading list' }));
    expect(useStore.getState()).toMatchObject({ workflowsOpen: false, activeViewId: 'b' });
  });

  it('makes a new view from a name, and opens it', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'New view' }));
    const input = within(dialog()).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Board of ideas' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(useStore.getState().views.map(v => v.name)).toEqual(['Open tasks', 'Reading list', 'Board of ideas']));
    expect(useStore.getState().activeViewId).toBe(useStore.getState().views[2].id);
  });

  it('renames a view, and cancelling changes nothing', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Rename view: Open tasks' }));
    fireEvent.change(within(dialog()).getByRole('textbox'), { target: { value: 'Done tasks' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(useStore.getState().views[0].name).toBe('Done tasks'));

    fireEvent.click(screen.getByRole('button', { name: 'Rename view: Reading list' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useStore.getState().views[1].name).toBe('Reading list');
  });

  it('duplicates a view and opens the copy', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate view: Reading list' }));
    await waitFor(() => expect(useStore.getState().views.map(v => v.name)).toContain('Reading list (copy)'));
  });

  it('asks before deleting a view, and says the notes are not touched', async () => {
    useStore.setState({ activeViewId: 'a' });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Delete view: Open tasks' }));
    expect(dialog()).toHaveTextContent('Your notes are not touched');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete view' }));
    await waitFor(() => expect(useStore.getState().views.map(v => v.id)).toEqual(['b']));
    expect(useStore.getState().activeViewId).toBeNull();
  });

  it('can be folded away, and opens again', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Views' }));
    expect(screen.queryByRole('button', { name: 'Reading list' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Views' }));
    expect(screen.getByRole('button', { name: 'Reading list' })).toBeInTheDocument();
  });
});
