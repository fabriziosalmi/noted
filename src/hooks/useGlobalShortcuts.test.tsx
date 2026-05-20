import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts } from './useGlobalShortcuts';

function Harness(args: Parameters<typeof useGlobalShortcuts>[0]) {
  useGlobalShortcuts(args);
  return null;
}

describe('useGlobalShortcuts', () => {
  it('does not open shortcuts when typing ? inside contenteditable', () => {
    const onToggleShortcuts = vi.fn();
    render(
      <Harness
        onToggleShortcuts={onToggleShortcuts}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={vi.fn()}
        onCreateNote={vi.fn()}
      />,
    );

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);

    const evt = new KeyboardEvent('keydown', { key: '?' });
    Object.defineProperty(evt, 'target', { value: editable });
    document.dispatchEvent(evt);
    expect(onToggleShortcuts).not.toHaveBeenCalled();
  });

  it('opens shortcuts for ? outside editable targets', () => {
    const onToggleShortcuts = vi.fn();
    render(
      <Harness
        onToggleShortcuts={onToggleShortcuts}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={vi.fn()}
        onCreateNote={vi.fn()}
      />,
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    expect(onToggleShortcuts).toHaveBeenCalledTimes(1);
  });

  it('uses layout-safe Backslash code for focus mode', () => {
    const onToggleFocusMode = vi.fn();
    render(
      <Harness
        onToggleShortcuts={vi.fn()}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={onToggleFocusMode}
        onCreateNote={vi.fn()}
      />,
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '|', code: 'Backslash', metaKey: true }));
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it('ignores AltGr-like Ctrl+Alt combos for shortcut dispatch', () => {
    const onToggleFind = vi.fn();
    render(
      <Harness
        onToggleShortcuts={vi.fn()}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={onToggleFind}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={vi.fn()}
        onCreateNote={vi.fn()}
      />,
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, altKey: true }));
    expect(onToggleFind).not.toHaveBeenCalled();
  });

  it('ignores repeated keydown events to prevent repeated toggles', () => {
    const onToggleQuickOpen = vi.fn();
    render(
      <Harness
        onToggleShortcuts={vi.fn()}
        onToggleQuickOpen={onToggleQuickOpen}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={vi.fn()}
        onCreateNote={vi.fn()}
      />,
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, repeat: true }));
    expect(onToggleQuickOpen).not.toHaveBeenCalled();
  });
});
