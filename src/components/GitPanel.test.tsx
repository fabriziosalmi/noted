import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { GitPanel } from './GitPanel';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
let gitInit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gitInit = vi.fn(async () => ({ success: false, error: 'not allowed here' }));
  window.electronAPI = {
    ...original,
    gitStatus: vi.fn(async () => ({ success: true, data: { initialized: false, branch: '', remote: '', files: [], ahead: 0, behind: 0 } })),
    gitInit,
  } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' } });
});
afterEach(() => { window.electronAPI = original; vi.useRealTimers(); });

describe('GitPanel', () => {
  it('keeps an error on screen, announced, until it is closed', async () => {
    render(<GitPanel activeNoteName={null} onClose={vi.fn()} />);
    const init = await screen.findByRole('button', { name: 'Initialize Git' });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(init); });
    expect(screen.getByRole('alert')).toHaveTextContent('not allowed here');

    // It used to vanish after 6 s.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole('alert')).toHaveTextContent('not allowed here');

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
