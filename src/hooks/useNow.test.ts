import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNow } from './useNow';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe('useNow', () => {
  it('advances on the interval and stops on unmount', () => {
    const { result, unmount } = renderHook(() => useNow(10_000));
    expect(result.current).toBe(1_000_000);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe(1_010_000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes immediately when the bump value changes', () => {
    const { result, rerender } = renderHook(({ b }) => useNow(60_000, b), { initialProps: { b: 1 } });
    act(() => { vi.setSystemTime(1_005_000); });
    expect(result.current).toBe(1_000_000);
    rerender({ b: 2 });
    expect(result.current).toBe(1_005_000);
  });
});
