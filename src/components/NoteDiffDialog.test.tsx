import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NoteDiffDialog } from './NoteDiffDialog';
import type { GitFileChange } from '../types';

const original = window.electronAPI;
let gitFileDiff: ReturnType<typeof vi.fn>;

const file = (over: Partial<GitFileChange> = {}): GitFileChange => ({ path: 'Plan.md', state: 'modified', staged: false, unstaged: true, ...over });

beforeEach(() => {
  gitFileDiff = vi.fn(async () => ({
    success: true,
    data: { before: 'We ship Friday.\n', after: 'We ship Monday.\n', state: 'modified', isNew: false, isDeleted: false },
  }));
  window.electronAPI = { ...original, gitFileDiff } as unknown as typeof window.electronAPI;
});
afterEach(() => { window.electronAPI = original; });

describe('NoteDiffDialog', () => {
  it('asks for the comparison once, and shows it with the changed words marked', async () => {
    render(<NoteDiffDialog file={file()} syncDir="/v" onStage={vi.fn()} onUnstage={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('note-diff')).toBeTruthy());
    expect([...dialog.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['Friday', 'Monday']);
    await new Promise(r => setTimeout(r, 50)); // a re-render must not start the request over
    expect(gitFileDiff).toHaveBeenCalledTimes(1);
    expect(gitFileDiff).toHaveBeenCalledWith('Plan.md', '/v');
  });

  it('offers Stage for an unstaged change, Unstage for a staged one, both for a change staged and edited again', () => {
    const open = (f: GitFileChange) => {
      const { unmount } = render(<NoteDiffDialog file={f} onStage={vi.fn()} onUnstage={vi.fn()} onClose={vi.fn()} />);
      const names = screen.getAllByRole('button').map(b => b.textContent);
      unmount();
      return names;
    };
    expect(open(file({ staged: false, unstaged: true }))).toEqual(expect.arrayContaining(['Stage']));
    expect(open(file({ staged: false, unstaged: true }))).not.toContain('Unstage');
    expect(open(file({ staged: true, unstaged: false }))).toContain('Unstage');
    expect(open(file({ staged: true, unstaged: false }))).not.toContain('Stage');
    expect(open(file({ staged: true, unstaged: true }))).toEqual(expect.arrayContaining(['Stage', 'Unstage']));
  });

  it('calls the right handler', () => {
    const onStage = vi.fn();
    const onUnstage = vi.fn();
    render(<NoteDiffDialog file={file({ staged: true, unstaged: true })} onStage={onStage} onUnstage={onUnstage} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unstage' }));
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onUnstage).toHaveBeenCalledTimes(1);
  });

  it('shows why a comparison failed', async () => {
    gitFileDiff.mockResolvedValue({ success: false, error: 'This note is too large to compare' });
    render(<NoteDiffDialog file={file()} onStage={vi.fn()} onUnstage={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('This note is too large to compare');
  });

  it('says so, in words, when the call itself fails', async () => {
    gitFileDiff.mockRejectedValue(new Error('boom'));
    render(<NoteDiffDialog file={file()} onStage={vi.fn()} onUnstage={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not compare this note.');
  });
});
