import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MAX_TOASTS, useToast } from './useToast';

describe('useToast', () => {
  it('shows at most a few toasts, dropping the oldest, and never the same one twice', () => {
    const { result } = renderHook(() => useToast());
    act(() => { for (let i = 1; i <= 5; i++) result.current.toast(`message ${i}`, 'error'); });
    expect(result.current.messages.map(m => m.text)).toEqual(['message 3', 'message 4', 'message 5']);
    expect(result.current.messages).toHaveLength(MAX_TOASTS);

    act(() => { result.current.toast('message 5', 'error'); });
    expect(result.current.messages.map(m => m.text)).toEqual(['message 3', 'message 4', 'message 5']);
    act(() => { result.current.toast('message 5', 'success'); }); // same text, other kind: a different message
    expect(result.current.messages.at(-1)).toMatchObject({ text: 'message 5', variant: 'success' });
  });
});
