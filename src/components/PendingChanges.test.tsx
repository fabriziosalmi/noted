import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PendingChangesBadge } from './PendingChanges';
import { useStore } from '../store/useStore';
import type { PendingChange } from '../../shared/vault/pending';

const original = window.electronAPI;
const change = (id: string, over: Partial<PendingChange> = {}): PendingChange => ({
  id: id.repeat(16).slice(0, 16), createdAt: '2026-10-07T10:00:00Z', client: 'claude-code', tool: 'update_note', kind: 'update',
  note: 'drafts/plan.md', baseEtag: 'e', before: 'line one\nquarterly roadmap\n', after: 'line one\nyearly roadmap\n', ...over,
});
let queue: PendingChange[];
let listPendingChanges: ReturnType<typeof vi.fn>;
let settlePendingChange: ReturnType<typeof vi.fn>;
const notice = vi.fn();

beforeEach(() => {
  queue = [change('a'), change('b', { kind: 'create', note: 'drafts/new.md', baseEtag: null, before: null, after: '# New\n' })];
  listPendingChanges = vi.fn(async () => ({ success: true, data: [...queue] }));
  settlePendingChange = vi.fn(async (id: string) => { queue = queue.filter(c => c.id !== id); return { success: true }; });
  window.electronAPI = { ...original, listPendingChanges, settlePendingChange, getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }) } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' } });
});
afterEach(() => { window.electronAPI = original; notice.mockClear(); });

const open = async () => {
  render(<PendingChangesBadge onNotice={notice} />);
  fireEvent.click(await screen.findByTestId('pending-badge'));
  return screen.getByRole('dialog');
};

describe('PendingChangesBadge', () => {
  it('shows nothing when nothing waits, and a count when something does', async () => {
    queue = [];
    const { container } = render(<PendingChangesBadge />);
    await waitFor(() => expect(listPendingChanges).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('the badge counts, and the review shows each change as a difference, who asked, and what kind', async () => {
    render(<PendingChangesBadge />);
    const badge = await screen.findByTestId('pending-badge');
    expect(badge).toHaveAccessibleName('2 change(s) from assistants waiting for approval');
    expect(badge).toHaveTextContent('2');
    fireEvent.click(badge);
    const first = document.querySelector(`[data-pending="${queue[0].id}"]`) as HTMLElement;
    expect(first.querySelector('header')).toHaveTextContent('Changed');
    expect(first).toHaveTextContent('drafts/plan.md');
    expect(first).toHaveTextContent('claude-code');
    expect(within(first).getByText('yearly').tagName).toBe('MARK'); // the words that changed are marked
    expect(within(first).getByText('quarterly').tagName).toBe('MARK');
    const second = document.querySelector(`[data-pending="${queue[1].id}"]`) as HTMLElement;
    expect(second.querySelector('header')).toHaveTextContent('New note');
  });

  it('approving makes the change and takes it off the list; rejecting drops it', async () => {
    await open();
    const [a, b] = [queue[0], queue[1]];
    fireEvent.click(within(document.querySelector(`[data-pending="${a.id}"]`) as HTMLElement).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenCalledWith(a.id, true, undefined));
    await waitFor(() => expect(document.querySelector(`[data-pending="${a.id}"]`)).toBeNull());
    fireEvent.click(within(document.querySelector(`[data-pending="${b.id}"]`) as HTMLElement).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenLastCalledWith(b.id, false, undefined));
    expect(await screen.findByText('Nothing is waiting for approval.')).toBeInTheDocument();
  });

  it('a change to a note that has changed since says so, cannot be approved, and can be rejected', async () => {
    settlePendingChange.mockResolvedValueOnce({ success: false, conflict: true, error: 'the note was changed since the agent saw it' });
    await open();
    const a = queue[0];
    const section = () => document.querySelector(`[data-pending="${a.id}"]`) as HTMLElement;
    fireEvent.click(within(section()).getByRole('button', { name: 'Approve' }));
    expect(await within(section()).findByRole('alert')).toHaveTextContent('cannot be applied');
    expect(within(section()).getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.click(within(section()).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenLastCalledWith(a.id, false, undefined));
  });

  it('a failure other than a conflict is reported', async () => {
    settlePendingChange.mockResolvedValueOnce({ success: false, error: 'disk full' });
    await open();
    fireEvent.click(within(document.querySelector(`[data-pending="${queue[0].id}"]`) as HTMLElement).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Could not settle the change: disk full', 'error'));
  });

  it('approve all and reject all go through the whole list', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve all' }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenCalledTimes(2));
    expect(settlePendingChange.mock.calls.every(c => c[1] === true)).toBe(true);
  });
});
