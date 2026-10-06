import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFieldSchema } from './useFieldSchema';
import { useStore } from '../store/useStore';

describe('useFieldSchema', () => {
  it('follows the notes\' fields, and keeps its answer while they do not change', () => {
    useStore.setState({ frontmatterIndex: { 'a.md': { status: 'open' }, 'b.md': { status: 'done', votes: 2 } } });
    const { result, rerender } = renderHook(() => useFieldSchema());
    expect(result.current.map(f => [f.name, f.type])).toEqual([['status', 'select'], ['votes', 'number']]);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => useStore.setState({ frontmatterIndex: { 'a.md': { due: '2026-10-06' } } }));
    expect(result.current.map(f => [f.name, f.type])).toEqual([['due', 'date']]);
  });
});
