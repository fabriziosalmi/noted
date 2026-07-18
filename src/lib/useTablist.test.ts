import { describe, it, expect } from 'vitest';
import { nextTabIndex } from './useTablist';

describe('nextTabIndex', () => {
  it('wraps forward with ArrowRight', () => {
    expect(nextTabIndex('ArrowRight', 0, 4)).toBe(1);
    expect(nextTabIndex('ArrowRight', 3, 4)).toBe(0);
  });

  it('wraps backward with ArrowLeft', () => {
    expect(nextTabIndex('ArrowLeft', 1, 4)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 4)).toBe(3);
  });

  it('jumps to first / last with Home / End', () => {
    expect(nextTabIndex('Home', 2, 4)).toBe(0);
    expect(nextTabIndex('End', 1, 4)).toBe(3);
  });

  it('returns -1 for non-navigation keys', () => {
    expect(nextTabIndex('Enter', 0, 4)).toBe(-1);
    expect(nextTabIndex('a', 0, 4)).toBe(-1);
    expect(nextTabIndex('ArrowDown', 0, 4)).toBe(-1);
  });

  it('is safe for an empty tab set', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBe(-1);
  });
});
