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

  it('triggers quick open on Cmd+p or Ctrl+p', () => {
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
    const evt = new KeyboardEvent('keydown', { key: 'p', metaKey: true });
    const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
    document.dispatchEvent(evt);
    expect(onToggleQuickOpen).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('triggers find on Cmd+f or Ctrl+f', () => {
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
    const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
    document.dispatchEvent(evt);
    expect(onToggleFind).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('triggers global search on Cmd+Shift+f or Ctrl+Shift+f', () => {
    const onToggleGlobalSearch = vi.fn();
    render(
      <Harness
        onToggleShortcuts={vi.fn()}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={onToggleGlobalSearch}
        onToggleFocusMode={vi.fn()}
        onCreateNote={vi.fn()}
      />,
    );
    const evt = new KeyboardEvent('keydown', { key: 'f', metaKey: true, shiftKey: true });
    const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
    document.dispatchEvent(evt);
    expect(onToggleGlobalSearch).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('triggers create note on Cmd+n or Ctrl+n', () => {
    const onCreateNote = vi.fn();
    render(
      <Harness
        onToggleShortcuts={vi.fn()}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={vi.fn()}
        onCreateNote={onCreateNote}
      />,
    );
    const evt = new KeyboardEvent('keydown', { key: 'n', metaKey: true });
    const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
    document.dispatchEvent(evt);
    expect(onCreateNote).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('ignores ? shortcut when focused in input, textarea, or nested contenteditable element', () => {
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

    // Test input target
    const input = document.createElement('input');
    document.body.appendChild(input);
    const inputEvt = new KeyboardEvent('keydown', { key: '?' });
    Object.defineProperty(inputEvt, 'target', { value: input });
    document.dispatchEvent(inputEvt);
    expect(onToggleShortcuts).not.toHaveBeenCalled();

    // Test textarea target
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const textareaEvt = new KeyboardEvent('keydown', { key: '?' });
    Object.defineProperty(textareaEvt, 'target', { value: textarea });
    document.dispatchEvent(textareaEvt);
    expect(onToggleShortcuts).not.toHaveBeenCalled();

    // Test nested element inside contenteditable target
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    document.body.appendChild(editable);
    const childEvt = new KeyboardEvent('keydown', { key: '?' });
    Object.defineProperty(childEvt, 'target', { value: child });
    document.dispatchEvent(childEvt);
    expect(onToggleShortcuts).not.toHaveBeenCalled();

    // Clean up DOM elements
    document.body.removeChild(input);
    document.body.removeChild(textarea);
    document.body.removeChild(editable);
  });

  it('removes event listener on unmount', () => {
    const onCreateNote = vi.fn();
    const { unmount } = render(
      <Harness
        onToggleShortcuts={vi.fn()}
        onToggleQuickOpen={vi.fn()}
        onToggleFind={vi.fn()}
        onToggleGlobalSearch={vi.fn()}
        onToggleFocusMode={vi.fn()}
        onCreateNote={onCreateNote}
      />,
    );

    unmount();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));
    expect(onCreateNote).not.toHaveBeenCalled();
  });
});
