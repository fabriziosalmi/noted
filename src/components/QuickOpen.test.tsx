import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickOpen } from './QuickOpen';
import type { NoteFile } from '../store/useStore';

const now = Date.now();
const mk = (name: string, mtimeMs: number): NoteFile => ({
  name,
  path: `/tmp/${name}`,
  stats: { mtimeMs, ctimeMs: mtimeMs, size: 1 },
});

describe('QuickOpen', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('shows recent notes first when query is empty', async () => {
    const notes = [
      mk('old.md', now - 1000 * 60 * 60),
      mk('new.md', now - 1000),
    ];

    render(<QuickOpen notes={notes} onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => {
      const rows = screen.getAllByRole('button').filter((el) => el.getAttribute('data-idx') !== null);
      expect(rows[0]).toHaveTextContent('new');
    });
  });

  it('creates note from query via keyboard enter', async () => {
    const onCreateNote = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickOpen
        notes={[mk('existing.md', now)]}
        onSelect={vi.fn()}
        onCreateNote={onCreateNote}
        onClose={onClose}
      />,
    );

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: 'brand-new' } });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => {
      expect(onCreateNote).toHaveBeenCalledWith('brand-new');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('runs command actions when query starts with slash', async () => {
    const onOpenSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickOpen
        notes={[mk('existing.md', now)]}
        onSelect={vi.fn()}
        onOpenSettings={onOpenSettings}
        onClose={onClose}
      />,
    );

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: '/settings' } });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => {
      expect(onOpenSettings).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
