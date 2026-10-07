import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { VaultHealthPage } from './VaultHealthPage';
import { ConfirmProvider } from './ConfirmProvider';
import { useStore } from '../store/useStore';
import { DEFAULT_LINT, type Finding, type LintReport } from '../../shared/lint/vaultLint';

vi.mock('../lib/llm', () => ({ askLLM: vi.fn(), describeLlmError: (e: Error) => `llm: ${e.message}` }));
import { askLLM } from '../lib/llm';

const original = window.electronAPI;
const report = (findings: Finding[], over: Partial<LintReport> = {}): LintReport => {
  const counts = { 'broken-link': 0, 'broken-heading': 0, isolated: 0, duplicate: 0, 'near-duplicate': 0, 'same-name': 0, stale: 0, empty: 0, 'no-summary': 0 };
  for (const f of findings) counts[f.kind]++;
  return { generatedAt: Date.UTC(2026, 9, 7), notes: 42, options: DEFAULT_LINT, findings, counts, unread: [], ...over };
};
const ALL: Finding[] = [
  { id: 'bl1', kind: 'broken-link', note: 'Hub.md', target: 'Quartely Report', suggestion: 'Quarterly Report.md' },
  { id: 'bl2', kind: 'broken-link', note: 'Hub.md', target: 'Gone', suggestion: null },
  { id: 'bh1', kind: 'broken-heading', note: 'Hub.md', target: 'Plan', resolved: 'Work/Plan.md', heading: 'Nope' },
  { id: 'iso1', kind: 'isolated', note: 'Alone.md' },
  { id: 'dup1', kind: 'duplicate', notes: ['Copy A.md', 'Copy B.md', 'Copy C.md'] },
  { id: 'near1', kind: 'near-duplicate', notes: ['A.md', 'B.md'], similarity: 0.91 },
  { id: 'same1', kind: 'same-name', name: 'Notes', notes: ['Home/Notes.md', 'Work/Notes.md'] },
  { id: 'old1', kind: 'stale', note: 'Old.md', days: 500 },
  { id: 'empty1', kind: 'empty', note: 'Blank.md' },
  { id: 'sum1', kind: 'no-summary', note: 'Long.md', words: 420 },
];
let current: LintReport;
let vaultLint: ReturnType<typeof vi.fn>;
let api: Record<string, ReturnType<typeof vi.fn>>;
const notice = vi.fn();
const openNote = vi.fn();

beforeEach(() => {
  current = report(ALL);
  vaultLint = vi.fn(async () => ({ success: true, data: current }));
  api = {
    saveNote: vi.fn(async () => ({ success: true })),
    createFolder: vi.fn(async () => ({ success: true })),
    rewriteLinks: vi.fn(async () => ({ success: true, data: {} })),
    moveNote: vi.fn(async () => ({ success: true })),
    deleteNote: vi.fn(async () => ({ success: true })),
    readNote: vi.fn(async () => ({ success: true, data: '<h1>Long</h1><p>A long note about many things.</p>' })),
    getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }),
  };
  window.electronAPI = { ...original, vaultLint, ...api } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en', piiMasking: false }, healthOpen: true });
  vi.mocked(askLLM).mockReset();
});
afterEach(() => { window.electronAPI = original; notice.mockClear(); openNote.mockClear(); });

const page = async () => {
  render(<ConfirmProvider><VaultHealthPage onOpenNote={openNote} onNotice={notice} /></ConfirmProvider>);
  await screen.findByTestId('health-summary');
};
const item = (id: string) => document.querySelector(`[data-finding="${id}"]`) as HTMLElement;

describe('VaultHealthPage', () => {
  it('shows what was found, grouped, with how many, and what was checked', async () => {
    await page();
    expect(screen.getByTestId('health-summary')).toHaveTextContent('42 notes checked, 10 things to look at.');
    for (const [kind, n] of [['broken-link', 2], ['broken-heading', 1], ['isolated', 1], ['duplicate', 1], ['near-duplicate', 1], ['same-name', 1], ['stale', 1], ['empty', 1], ['no-summary', 1]] as const) {
      expect(screen.getByTestId(`count-${kind}`)).toHaveTextContent(String(n));
    }
    expect(vaultLint).toHaveBeenCalledWith({ staleDays: 365 }, undefined);
  });

  it('says so when all is well, and which notes were too large to read', async () => {
    current = report([], { unread: ['Big.md', 'Huge.md'] });
    await page();
    expect(screen.getByTestId('health-clean')).toBeInTheDocument();
    expect(screen.getByText('2 note(s) are too large to be read and are not in this report.')).toBeInTheDocument();
  });

  it('a note in a finding opens on a click', async () => {
    await page();
    fireEvent.click(within(item('iso1')).getByRole('button', { name: 'Alone' }));
    expect(openNote).toHaveBeenCalledWith('Alone.md');
    fireEvent.click(within(item('bh1')).getByRole('button', { name: 'Work/Plan' }));
    expect(openNote).toHaveBeenLastCalledWith('Work/Plan.md');
  });

  it('creates the note a link names, without leaving the page, and checks again', async () => {
    await page();
    fireEvent.click(within(item('bl2')).getByRole('button', { name: 'Create the note' }));
    await waitFor(() => expect(api.saveNote).toHaveBeenCalledWith('Gone.md', '<h1>Gone</h1><p></p>', undefined));
    await waitFor(() => expect(vaultLint).toHaveBeenCalledTimes(2));
    expect(openNote).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith('Done.', 'success');
  });

  it('a link that names a folder gets its folders first, one level at a time, and a folder that is already there is no error', async () => {
    current = report([{ id: 'deep', kind: 'broken-link', note: 'Hub.md', target: 'Work/Q4/Plan', suggestion: null }]);
    api.createFolder.mockResolvedValueOnce({ success: false, error: 'Folder "Work" already exists' }).mockResolvedValueOnce({ success: true });
    await page();
    fireEvent.click(within(item('deep')).getByRole('button', { name: 'Create the note' }));
    await waitFor(() => expect(api.saveNote).toHaveBeenCalledWith('Work/Q4/Plan.md', '<h1>Plan</h1><p></p>', undefined));
    expect(api.createFolder.mock.calls.map(c => c[0])).toEqual(['Work', 'Work/Q4']);
  });

  it('points a link at the note it was meant for, by the same rewrite a rename uses', async () => {
    await page();
    expect(within(item('bl1')).getByText('Did you mean Quarterly Report?')).toBeInTheDocument();
    fireEvent.click(within(item('bl1')).getByRole('button', { name: 'Use Quarterly Report' }));
    await waitFor(() => expect(api.rewriteLinks).toHaveBeenCalledWith([{ from: 'Quartely Report.md', to: 'Quarterly Report.md' }], undefined));
    expect(within(item('bl2')).queryByRole('button', { name: /^Use / })).toBeNull(); // no guess, no button
  });

  it('archives a stale note into Archive/, keeping its links up to date', async () => {
    await page();
    fireEvent.click(within(item('old1')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.moveNote).toHaveBeenCalledWith('Old.md', 'Archive', undefined, { updateLinks: true }));
  });

  it('trashing asks first and names what stays; cancelling does nothing; confirming moves only the copies', async () => {
    await page();
    fireEvent.click(within(item('dup1')).getByRole('button', { name: 'Keep the oldest, trash 2 other' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Keep Copy A and move 2 copy(ies) to the trash?');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.deleteNote).not.toHaveBeenCalled();

    fireEvent.click(within(item('dup1')).getByRole('button', { name: 'Keep the oldest, trash 2 other' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Move to the trash' }));
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledTimes(2));
    expect(api.deleteNote.mock.calls.map(c => c[0])).toEqual(['Copy B.md', 'Copy C.md']);
  });

  it('an empty note can be trashed, after asking', async () => {
    await page();
    fireEvent.click(within(item('empty1')).getByRole('button', { name: 'Move to the trash' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Move Blank to the trash? You can take it back from there.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to the trash' }));
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith('Blank.md', undefined));
  });

  it('a failed fix says why and changes nothing else', async () => {
    api.moveNote.mockResolvedValueOnce({ success: false, error: 'disk full' });
    await page();
    fireEvent.click(within(item('old1')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Could not do that: disk full', 'error'));
  });

  it('a summary is suggested by the model, shown to be edited, and only written when saved', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('  A note about many things.  ');
    const setNoteProperty = vi.fn(async () => ({ ok: true as const }));
    useStore.setState({ setNoteProperty } as never);
    await page();
    fireEvent.click(within(item('sum1')).getByRole('button', { name: 'Suggest a summary' }));
    const box = await within(item('sum1')).findByRole('textbox');
    expect(box).toHaveValue('A note about many things.');
    expect(vi.mocked(askLLM).mock.calls[0][0][1].content).toBe('Long A long note about many things.'); // the text of the note, as the model sees it
    expect(setNoteProperty).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'My own words.' } });
    fireEvent.click(within(item('sum1')).getByRole('button', { name: 'Save as summary' }));
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('Long.md', 'summary', 'My own words.'));
  });

  it('a model that fails leaves the note alone and says so', async () => {
    vi.mocked(askLLM).mockRejectedValueOnce(new Error('no key'));
    await page();
    fireEvent.click(within(item('sum1')).getByRole('button', { name: 'Suggest a summary' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Could not do that: llm: no key', 'error'));
    expect(within(item('sum1')).queryByRole('textbox')).toBeNull();
  });

  it('the staleness threshold is asked for again when it changes', async () => {
    await page();
    fireEvent.change(screen.getByLabelText('Not touched for'), { target: { value: '90' } });
    await waitFor(() => expect(vaultLint).toHaveBeenLastCalledWith({ staleDays: 90 }, undefined));
  });

  it('saves the report as a note in reports/, written as the wire form, and opens it', async () => {
    await page();
    fireEvent.click(screen.getByRole('button', { name: 'Save as a note' }));
    await waitFor(() => expect(api.saveNote).toHaveBeenCalled());
    const [name, html] = api.saveNote.mock.calls[0] as [string, string];
    expect(name).toMatch(/^reports\/Vault health \d{4}-\d{2}-\d{2}\.md$/);
    expect(html).toContain('<h1>Vault health');
    expect(html).toContain('<h2>Broken links (2)');
    expect(api.createFolder).toHaveBeenCalledWith('reports', undefined); // the folder first
    expect(openNote).toHaveBeenCalledWith(name);
  });

  it('a long list shows the first part, and all of it on request', async () => {
    current = report(Array.from({ length: 60 }, (_, i): Finding => ({ id: `iso${i}`, kind: 'isolated', note: `N${i}.md` })));
    await page();
    expect(document.querySelectorAll('[data-finding]')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 60' }));
    expect(document.querySelectorAll('[data-finding]')).toHaveLength(60);
  });

  it('a check that fails says why', async () => {
    vaultLint.mockResolvedValueOnce({ success: false, error: 'index busy' });
    render(<ConfirmProvider><VaultHealthPage onOpenNote={openNote} /></ConfirmProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The check failed: index busy');
  });
});
