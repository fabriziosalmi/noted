import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentActivityPage } from './AgentActivityPage';
import { useStore } from '../store/useStore';
import type { JournalEntry } from '../../shared/vault/journalTypes';

const original = window.electronAPI;
const entry = (seq: number, over: Partial<JournalEntry> = {}): JournalEntry => ({
  seq, id: `e${seq}`, at: `2026-10-07T10:0${seq}:00.000Z`, client: 'claude-code', session: 's1', tool: 'update_note', via: 'direct', kind: 'update',
  note: 'Work/plan.md', beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64), prev: null, hash: 'c'.repeat(64), ...over,
});
let journalList: ReturnType<typeof vi.fn>;
let journalDiff: ReturnType<typeof vi.fn>;
let journalRevert: ReturnType<typeof vi.fn>;
const notice = vi.fn();
const data = (entries: JournalEntry[], extra: object = {}) => ({ success: true, data: { entries, total: entries.length, reverted: [], chain: { ok: true, entries: entries.length }, ...extra } });

beforeEach(() => {
  journalList = vi.fn().mockResolvedValue(data([
    entry(4, { session: 's2', client: 'gemini', note: 'Home/new.md', kind: 'create', tool: 'create_note' }),
    entry(3),
    entry(2, { note: 'Work/old.md', kind: 'delete', tool: 'delete_note', via: 'approval' }),
    entry(1),
  ]));
  journalDiff = vi.fn().mockResolvedValue({ success: true, data: { before: 'quarterly roadmap\n', after: 'yearly roadmap\n', kept: true } });
  journalRevert = vi.fn().mockResolvedValue({ success: true, data: [{ id: 'e3', ok: true }] });
  window.electronAPI = { ...original, journalList, journalDiff, journalRevert, getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }) } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' }, activityOpen: true });
});
afterEach(() => { window.electronAPI = original; notice.mockClear(); });

const page = () => render(<AgentActivityPage onOpenNote={vi.fn()} onNotice={notice} />);

describe('AgentActivityPage', () => {
  it('lists the changes by session, the latest session first, with who, what kind, which note, and the chain verified', async () => {
    page();
    expect(await screen.findByTestId('activity-chain')).toHaveTextContent('Journal verified: 4 entries, the chain is intact.');
    const sessions = [...document.querySelectorAll('[data-session]')].map(s => s.getAttribute('data-session'));
    expect(sessions).toEqual(['s2', 's1']);
    const s1 = document.querySelector('[data-session="s1"]') as HTMLElement;
    expect(s1).toHaveTextContent('claude-code');
    expect(s1).toHaveTextContent('3 change(s)');
    expect(within(document.querySelector('[data-entry="e2"]') as HTMLElement).getByText('approved')).toBeInTheDocument();
    expect(within(document.querySelector('[data-entry="e4"]') as HTMLElement).getByText('New')).toBeInTheDocument();
  });

  it('shows the difference of a change when asked, and hides it again', async () => {
    page();
    const row = (await screen.findByText('Work/old', {}, { timeout: 3000 }).then(() => document.querySelector('[data-entry="e3"]'))) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Show changes' }));
    await waitFor(() => expect(journalDiff).toHaveBeenCalledWith('e3', undefined));
    expect(await within(row).findByText('yearly')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Hide changes' }));
    expect(within(row).queryByText('yearly')).toBeNull();
  });

  it('filters by assistant, by kind and by note', async () => {
    page();
    await screen.findByTestId('activity-chain');
    fireEvent.change(screen.getByLabelText('Assistant'), { target: { value: 'gemini' } });
    expect([...document.querySelectorAll('[data-entry]')].map(e => e.getAttribute('data-entry'))).toEqual(['e4']);
    fireEvent.change(screen.getByLabelText('Assistant'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'delete' } });
    expect([...document.querySelectorAll('[data-entry]')].map(e => e.getAttribute('data-entry'))).toEqual(['e2']);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by note'), { target: { value: 'PLAN' } });
    expect([...document.querySelectorAll('[data-entry]')].map(e => e.getAttribute('data-entry'))).toEqual(['e3', 'e1']);
  });

  it('undoes one change, and says so; a refused undo says why', async () => {
    page();
    await screen.findByTestId('activity-chain');
    const row = document.querySelector('[data-entry="e3"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(journalRevert).toHaveBeenCalledWith(['e3'], undefined));
    expect(await within(row).findByText('Undone.')).toBeInTheDocument();
    journalRevert.mockResolvedValueOnce({ success: true, data: [{ id: 'e1', ok: false, conflict: true, error: 'the note was changed after the agent changed it' }] });
    fireEvent.click(within(document.querySelector('[data-entry="e1"]') as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Not undone: the note was changed after the agent changed it')).toBeInTheDocument();
  });

  it('undoes a whole session, newest changes first in the request, only the ones that can still be undone', async () => {
    journalList.mockResolvedValue(data([entry(3), entry(2, { via: 'revert' }), entry(1)], { reverted: [] }));
    page();
    await screen.findByTestId('activity-chain');
    fireEvent.click(screen.getByRole('button', { name: 'Undo this session' }));
    await waitFor(() => expect(journalRevert).toHaveBeenCalledWith(['e3', 'e1'], undefined)); // the undo entry is not one of them
  });

  it('a change already undone is marked and cannot be undone again', async () => {
    journalList.mockResolvedValue(data([entry(2), entry(1)], { reverted: ['e1'] }));
    page();
    await screen.findByTestId('activity-chain');
    const row = document.querySelector('[data-entry="e1"]') as HTMLElement;
    expect(within(row).getByText('undone')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a journal that was changed after it was written is shown as an alert, with where', async () => {
    journalList.mockResolvedValue(data([entry(2), entry(1)], { chain: { ok: false, at: 2, reason: 'it was changed after it was written' } }));
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('entry 2 it was changed after it was written');
  });

  it('says when assistants have changed nothing', async () => {
    journalList.mockResolvedValue(data([]));
    page();
    expect(await screen.findByText('Assistants have not changed anything in this vault yet.')).toBeInTheDocument();
  });
});
