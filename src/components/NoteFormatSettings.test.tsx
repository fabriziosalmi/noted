import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NoteFormatSettings } from './NoteFormatSettings';
import { useStore } from '../store/useStore';
import { setPendingSaveFlusher } from '../lib/pendingSave';
import type { MigrationOutcome, MigrationReport } from '../types';

const report = (over: Partial<MigrationReport> = {}): MigrationReport => ({
  direction: 'to-markdown',
  total: 12,
  convert: 10,
  skip: 2,
  verdicts: { exact: 8, raw: 1, formatting: 1, lossy: 0 },
  failed: 0,
  notes: [
    { name: 'Plan.md', verdict: 'raw', findings: ['<details> kept as raw HTML'] },
    { name: 'Colours.md', verdict: 'formatting', findings: ['text colour dropped'] },
  ],
  truncated: false,
  ...over,
});

interface Mock {
  getVaultFormat: ReturnType<typeof vi.fn>;
  migrationPlan: ReturnType<typeof vi.fn>;
  migrationApply: ReturnType<typeof vi.fn>;
  migrationRevert: ReturnType<typeof vi.fn>;
  onVaultFormatChanged: ReturnType<typeof vi.fn>;
  onMigrationProgress: ReturnType<typeof vi.fn>;
}

let api: Mock;
let formatNow: 'html' | 'markdown';
const original = window.electronAPI;

beforeEach(() => {
  formatNow = 'html';
  api = {
    getVaultFormat: vi.fn(async () => ({ success: true, data: formatNow })),
    migrationPlan: vi.fn(async () => ({ success: true, data: report() })),
    migrationApply: vi.fn(async (): Promise<MigrationOutcome> => { formatNow = 'markdown'; return { ok: true, report: report(), backup: '/v/.noted/backups/b.zip', converted: 10 }; }),
    migrationRevert: vi.fn(async (): Promise<MigrationOutcome> => { formatNow = 'html'; return { ok: true, report: report({ direction: 'to-html' }), backup: '/v/.noted/backups/c.zip', converted: 10 }; }),
    onVaultFormatChanged: vi.fn(() => () => undefined),
    onMigrationProgress: vi.fn(() => () => undefined),
  };
  window.electronAPI = { ...original, ...api } as unknown as typeof window.electronAPI;
  useStore.setState({ vaultConverting: false });
});

afterEach(() => {
  window.electronAPI = original;
  setPendingSaveFlusher(null);
});

const open = async () => {
  render(<NoteFormatSettings syncDirectory={null} />);
  await waitFor(() => expect(screen.getByTestId('note-format-current')).toBeTruthy());
};

describe('NoteFormatSettings', () => {
  it('says how the vault is stored and offers the way to the other format', async () => {
    await open();
    expect(screen.getByTestId('note-format-current').textContent).toContain('HTML');
    expect(screen.getByRole('button', { name: /Convert to Markdown/ })).toBeTruthy();
  });

  it('offers to go back when the vault is Markdown', async () => {
    formatNow = 'markdown';
    await open();
    expect(screen.getByTestId('note-format-current').textContent).toContain('Markdown');
    expect(screen.getByRole('button', { name: /Convert back to HTML/ })).toBeTruthy();
  });

  it('shows the plan first, changes nothing, and makes the open note read-only meanwhile', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    expect(screen.getByTestId('note-format-summary').textContent).toContain('10 to convert');
    expect(screen.getByTestId('note-format-notes').textContent).toContain('Plan.md');
    expect(screen.getByTestId('note-format-notes').textContent).toContain('text colour dropped');
    expect(api.migrationApply).not.toHaveBeenCalled();
    expect(useStore.getState().vaultConverting).toBe(true);
  });

  it('writes what is typed but not saved before it looks at the vault', async () => {
    const order: string[] = [];
    setPendingSaveFlusher(async () => { order.push('flush'); });
    api.migrationPlan.mockImplementation(async () => { order.push('plan'); return { success: true, data: report() }; });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    expect(order).toEqual(['flush', 'plan']);
  });

  it('cancelling leaves the vault alone and the note editable again', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('note-format-summary')).toBeNull();
    expect(api.migrationApply).not.toHaveBeenCalled();
    expect(useStore.getState().vaultConverting).toBe(false);
  });

  it('converts, reports where the backup is, and shows the new format', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    const done = await screen.findByTestId('note-format-done');
    expect(done.textContent).toContain('10');
    expect(done.textContent).toContain('/v/.noted/backups/b.zip');
    expect(api.migrationApply).toHaveBeenCalledWith({ allowLossy: false }, undefined);
    expect(useStore.getState().vaultConverting).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('note-format-current').textContent).toContain('Markdown'));
  });

  it('will not convert notes that would lose text until the user says so', async () => {
    api.migrationPlan.mockResolvedValue({ success: true, data: report({ verdicts: { exact: 8, raw: 0, formatting: 0, lossy: 2 }, notes: [{ name: 'Odd.md', verdict: 'lossy', findings: ['a <canvas> was dropped'] }] }) });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    const convert = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    expect(convert.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(convert.disabled).toBe(false);
    fireEvent.click(convert);
    await screen.findByTestId('note-format-done');
    expect(api.migrationApply).toHaveBeenCalledWith({ allowLossy: true }, undefined);
  });

  it('cannot convert at all while a note fails to convert', async () => {
    api.migrationPlan.mockResolvedValue({ success: true, data: report({ failed: 1, notes: [{ name: 'Bad.md', findings: [], error: 'could not be read: EACCES' }] }) });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    expect((screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Nothing was changed');
    expect(screen.getByTestId('note-format-notes').textContent).toContain('EACCES');
  });

  it('shows why a conversion stopped, and that the notes were put back', async () => {
    api.migrationApply.mockResolvedValue({ ok: false, reason: 'Stopped, and every note was restored: disk full' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByTestId('note-format-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect((await screen.findByTestId('note-format-error')).textContent).toContain('every note was restored');
    expect(useStore.getState().vaultConverting).toBe(false);
  });

  it('goes back to HTML through the revert call', async () => {
    formatNow = 'markdown';
    api.migrationPlan.mockResolvedValue({ success: true, data: report({ direction: 'to-html', verdicts: { exact: 10, raw: 0, formatting: 0, lossy: 0 }, notes: [] }) });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert back to HTML/ }));
    await screen.findByTestId('note-format-summary');
    expect(api.migrationPlan).toHaveBeenCalledWith('to-html', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await screen.findByTestId('note-format-done');
    expect(api.migrationRevert).toHaveBeenCalled();
    expect(api.migrationApply).not.toHaveBeenCalled();
  });

  it('reports a plan that could not be made, and leaves the note editable', async () => {
    api.migrationPlan.mockResolvedValue({ success: false, error: 'boom' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Convert to Markdown/ }));
    await screen.findByText('boom');
    expect(useStore.getState().vaultConverting).toBe(false);
  });
});
