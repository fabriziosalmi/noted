import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ mac: false }));
vi.mock('../lib/platform', async importOriginal => ({ ...(await importOriginal<object>()), get isMac() { return platform.mac; } }));

import { useGlobalShortcuts } from './useGlobalShortcuts';

function Harness(args: Parameters<typeof useGlobalShortcuts>[0]) {
  useGlobalShortcuts(args);
  return null;
}
const press = (init: KeyboardEventInit) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const args = (onOpenReplace = vi.fn()) => ({
  onToggleShortcuts: vi.fn(), onToggleQuickOpen: vi.fn(), onPrintNote: vi.fn(), onToggleFind: vi.fn(),
  onToggleGlobalSearch: vi.fn(), onToggleFocusMode: vi.fn(), onCreateNote: vi.fn(), onOpenReplace,
});

describe('Find and replace shortcut', () => {
  it('is ⌘⌥F on macOS, where Ctrl+H stays the system’s delete-backward', () => {
    platform.mac = true;
    const onOpenReplace = vi.fn();
    const { unmount } = render(<Harness {...args(onOpenReplace)} />);
    press({ key: 'h', code: 'KeyH', ctrlKey: true });
    expect(onOpenReplace).not.toHaveBeenCalled();
    press({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true });
    expect(onOpenReplace).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('is Ctrl+H on Windows and Linux', () => {
    platform.mac = false;
    const onOpenReplace = vi.fn();
    const { unmount } = render(<Harness {...args(onOpenReplace)} />);
    press({ key: 'h', code: 'KeyH', ctrlKey: true });
    expect(onOpenReplace).toHaveBeenCalledTimes(1);
    unmount();
  });
});
