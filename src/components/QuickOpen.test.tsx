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

  it('closes on backdrop mouse down', () => {
    const onClose = vi.fn();
    render(<QuickOpen notes={[]} onSelect={vi.fn()} onClose={onClose} />);
    const backdrop = screen.getByLabelText(/close/i);
    
    // Non-left-click should not close
    fireEvent.mouseDown(backdrop, { button: 1 });
    expect(onClose).not.toHaveBeenCalled();

    // Left click should close
    fireEvent.mouseDown(backdrop, { button: 0 });
    expect(onClose).toHaveBeenCalled();
  });

  it('triggers all quick actions on click', () => {
    const onCreateNote = vi.fn();
    const onOpenDaily = vi.fn();
    const onOpenSettings = vi.fn();
    const onOpenTemplates = vi.fn();
    const onOpenShortcuts = vi.fn();
    const onClose = vi.fn();

    render(
      <QuickOpen
        notes={[]}
        onSelect={vi.fn()}
        onCreateNote={onCreateNote}
        onOpenDaily={onOpenDaily}
        onOpenSettings={onOpenSettings}
        onOpenTemplates={onOpenTemplates}
        onOpenShortcuts={onOpenShortcuts}
        onClose={onClose}
      />,
    );

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: '/' } });

    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-idx') !== null);
    
    // Hover the first action to trigger onMouseEnter and activeIdx change
    fireEvent.mouseEnter(buttons[0]);
    expect(buttons[0].className).toContain('var(--accent)');

    // The QuickOpen actions order: new-note, daily-note, settings, templates, shortcuts
    fireEvent.click(buttons[0]);
    expect(onCreateNote).toHaveBeenCalled();

    fireEvent.click(buttons[1]);
    expect(onOpenDaily).toHaveBeenCalled();

    fireEvent.click(buttons[2]);
    expect(onOpenSettings).toHaveBeenCalled();

    fireEvent.click(buttons[3]);
    expect(onOpenTemplates).toHaveBeenCalled();

    fireEvent.click(buttons[4]);
    expect(onOpenShortcuts).toHaveBeenCalled();
  });

  it('does not crash when optional action callbacks are undefined', () => {
    const onClose = vi.fn();
    render(
      <QuickOpen
        notes={[]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: '/' } });

    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-idx') !== null);
    
    // new-note calls onCreateNote?.()
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);

    // daily-note calls onOpenDaily?.()
    fireEvent.click(buttons[1]);
    expect(onClose).toHaveBeenCalledTimes(2);

    // settings calls onOpenSettings?.()
    fireEvent.click(buttons[2]);
    expect(onClose).toHaveBeenCalledTimes(3);

    // templates calls onOpenTemplates?.()
    fireEvent.click(buttons[3]);
    expect(onClose).toHaveBeenCalledTimes(4);

    // shortcuts calls onOpenShortcuts?.()
    fireEvent.click(buttons[4]);
    expect(onClose).toHaveBeenCalledTimes(5);
  });


  it('handles keyboard navigation boundary conditions and ignore events', () => {
    const notes = [mk('a.md', now), mk('b.md', now)];
    render(<QuickOpen notes={notes} onSelect={vi.fn()} onClose={vi.fn()} />);

    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-idx') !== null);
    
    // Starts with activeIdx = 0. Verify the class names or data properties.
    expect(buttons[0].className).toContain('var(--accent)');

    // ArrowUp on first element (activeIdx 0) -> stays at 0
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(buttons[0].className).toContain('var(--accent)');

    // ArrowDown should change activeIdx to 1
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(buttons[1].className).toContain('var(--accent)');

    // ArrowDown again on last element (activeIdx 1) -> stays at 1
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(buttons[1].className).toContain('var(--accent)');

    // ArrowUp should go back to 0
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(buttons[0].className).toContain('var(--accent)');

    // Ignored keyboard events (isComposing, repeat, defaultPrevented)
    fireEvent.keyDown(window, { key: 'ArrowDown', isComposing: true } as any);
    expect(buttons[0].className).toContain('var(--accent)');

    fireEvent.keyDown(window, { key: 'ArrowDown', repeat: true } as any);
    expect(buttons[0].className).toContain('var(--accent)');

    const defaultPreventedEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    Object.defineProperty(defaultPreventedEvent, 'defaultPrevented', { value: true });
    window.dispatchEvent(defaultPreventedEvent);
    expect(buttons[0].className).toContain('var(--accent)');
  });

  it('ignores ArrowDown/ArrowUp when totalRows is 0', () => {
    render(<QuickOpen notes={[]} onSelect={vi.fn()} onClose={vi.fn()} />);
    
    // Verify we don't crash when pressing arrow keys when list is empty
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
  });

  it('sets active index on hover and confirms note on click', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const notes = [mk('a.md', now), mk('b.md', now)];
    render(<QuickOpen notes={notes} onSelect={onSelect} onClose={onClose} />);

    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-idx') !== null);
    
    // Hover second note
    fireEvent.mouseEnter(buttons[1]);
    expect(buttons[1].className).toContain('var(--accent)');

    // Click second note
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('b.md');
    expect(onClose).toHaveBeenCalled();
  });

  it('handles create candidate hover and click', () => {
    const onCreateNote = vi.fn();
    const onClose = vi.fn();
    render(<QuickOpen notes={[]} onSelect={vi.fn()} onCreateNote={onCreateNote} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: 'cool-idea' } });

    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-idx') !== null);
    const createBtn = buttons[0];
    expect(createBtn.textContent).toContain('cool-idea');

    // Hover candidate
    fireEvent.mouseEnter(createBtn);
    expect(createBtn.className).toContain('var(--accent)');

    // Click candidate
    fireEvent.click(createBtn);
    expect(onCreateNote).toHaveBeenCalledWith('cool-idea');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders highlighted text with different styles based on active status', () => {
    const notes = [
      mk('search-one.md', now),
      mk('search-two.md', now),
    ];
    render(<QuickOpen notes={notes} onSelect={vi.fn()} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: 'search' } });

    const marks = screen.getAllByText('search');
    expect(marks).toHaveLength(2);
    // First note is active (default activeIdx 0) -> bg-white/30 text-white
    expect(marks[0].className).toContain('bg-white/30');
    // Second note is inactive (activeIdx 0, but this note is index 1) -> bg-[var(--accent-light)] text-[var(--accent)]
    expect(marks[1].className).toContain('bg-[var(--accent-light)]');
  });

  it('does not offer to create a note if it already exists', () => {
    const onCreateNote = vi.fn();
    const notes = [mk('existing.md', now)];
    render(
      <QuickOpen
        notes={notes}
        onSelect={vi.fn()}
        onCreateNote={onCreateNote}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: 'existing' } });

    // The create note button (which typically starts with "+") should not be in the document
    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('data-idx') !== null);
    const createBtn = buttons.find((b) => b.textContent?.startsWith('+'));
    expect(createBtn).toBeUndefined();
  });

  it('does not close if target is different from currentTarget on backdrop mouse down', () => {
    const onClose = vi.fn();
    render(<QuickOpen notes={[]} onSelect={vi.fn()} onClose={onClose} />);
    const backdrop = screen.getByLabelText(/close/i);
    
    // Simulate mouse down where target is a dummy div child of backdrop
    const dummyDiv = document.createElement('div');
    backdrop.appendChild(dummyDiv);
    fireEvent.mouseDown(dummyDiv, {
      button: 0,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores Enter key when there are no results', () => {
    const onSelect = vi.fn();
    render(<QuickOpen notes={[]} onSelect={onSelect} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText(/open note/i);
    fireEvent.change(input, { target: { value: 'nonexistent' } });

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens selected note via Enter key', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const notes = [mk('target-note.md', now)];
    render(<QuickOpen notes={notes} onSelect={onSelect} onClose={onClose} />);
    
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('target-note.md');
    expect(onClose).toHaveBeenCalled();
  });
});

