import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { printNoteFromHtml } from './printNote';

describe('printNoteFromHtml', () => {
  const t = ((key: string) => key) as never;
  let onToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onToast = vi.fn();
    // @ts-expect-error test resets the global
    window.electronAPI = undefined;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    window.electronAPI = undefined;
    vi.restoreAllMocks();
  });

  it('toasts an error and does nothing without html', async () => {
    const ok = await printNoteFromHtml('', 'Title', { t, onToast });
    expect(ok).toBe(false);
    expect(onToast).toHaveBeenCalledWith('noActiveNote', 'error');
  });

  it('falls back to window.print when Electron API is unavailable', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const ok = await printNoteFromHtml('<p>hi</p>', 'Title', { t, onToast });
    expect(ok).toBe(true);
    expect(printSpy).toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('forwards html to the Electron print-note handler', async () => {
    const printNote = vi.fn().mockResolvedValue({ success: true });
    // @ts-expect-error test double
    window.electronAPI = { printNote };
    const ok = await printNoteFromHtml('<p>hi</p>', 'My Note', { t, onToast });
    expect(ok).toBe(true);
    expect(printNote).toHaveBeenCalledWith('<p>hi</p>', 'My Note');
    expect(onToast).not.toHaveBeenCalled();
  });

  it('toasts when the Electron print fails', async () => {
    const printNote = vi.fn().mockResolvedValue({ success: false, error: 'boom' });
    // @ts-expect-error test double
    window.electronAPI = { printNote };
    const ok = await printNoteFromHtml('<p>hi</p>', 'My Note', { t, onToast });
    expect(ok).toBe(false);
    expect(onToast).toHaveBeenCalledWith('boom', 'error');
  });
});
