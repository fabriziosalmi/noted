import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { NoteHistoryModal } from './NoteHistoryModal';
import { ConfirmProvider } from './ConfirmProvider';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
const SNAPS = [{ name: 'a.html', ts: '2026-10-01 10:00' }, { name: 'b.html', ts: '2026-10-02 11:00' }];
let resolveA: (v: { success: boolean; data?: string }) => void;
let readB: () => Promise<{ success: boolean; data?: string; error?: string }>;
const onRestore = vi.fn();

beforeEach(() => {
  readB = async () => ({ success: false, error: 'gone' });
  const readNoteSnapshot = vi.fn((_file: string, snap: string) => snap === 'a.html'
    ? new Promise(resolve => { resolveA = resolve; })
    : readB());
  window.electronAPI = {
    ...original,
    getVaultFormat: vi.fn(async () => ({ success: true, data: 'html' })),
    getNoteHistory: vi.fn(async () => ({ success: true, data: SNAPS })),
    readNoteSnapshot,
  } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' } });
});
afterEach(() => { window.electronAPI = original; onRestore.mockClear(); });

const open = () => render(<ConfirmProvider><NoteHistoryModal fileName="Note.md" onRestore={onRestore} onClose={vi.fn()} /></ConfirmProvider>);

describe('NoteHistoryModal', () => {
  it('never shows (or restores) one version while another is selected', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: SNAPS[0].ts }));
    fireEvent.click(screen.getByRole('button', { name: SNAPS[1].ts }));
    // B could not be read: that is said, and there is nothing to restore.
    expect(await screen.findByRole('alert')).toHaveTextContent('This version could not be read.');
    // A's answer arrives late, after B was picked: it must not be shown under B.
    await act(async () => { resolveA({ success: true, data: '<p>version A text</p>' }); });
    expect(screen.queryByText('version A text')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });

  it('shows the version picked with the editor look, and names its time in the confirm', async () => {
    readB = async () => ({ success: true, data: '<ul><li><p>version B item</p></li></ul>' });
    open();
    fireEvent.click(await screen.findByRole('button', { name: SNAPS[1].ts }));
    const item = await screen.findByText('version B item');
    expect(item.closest('.ProseMirror.note-preview')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(await screen.findByText(/Restore the version of 2026-10-02 11:00\?/)).toBeInTheDocument();
  });
});
