import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { ReviewDiff } from './ReviewDiff';

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const before = [...lines(10), 'old A', ...lines(10, 'mid'), 'old B', ...lines(10, 'end')].join('\n');
const after = [...lines(10), 'new A', ...lines(10, 'mid'), 'new B', ...lines(10, 'end')].join('\n');

function Harness({ initial, onChange }: { initial?: number[]; onChange?: (s: Set<number>) => void }) {
  const [accepted, setAccepted] = useState<Set<number>>(new Set(initial ?? [0, 1]));
  return <ReviewDiff before={before} after={after} accepted={accepted} onChange={n => { setAccepted(n); onChange?.(n); }} />;
}

describe('ReviewDiff', () => {
  it('shows each change on its own, with a few lines around it and the rest folded', () => {
    render(<Harness />);
    expect(document.querySelectorAll('[data-change]')).toHaveLength(2);
    const first = document.querySelector('[data-change="0"]') as HTMLElement;
    expect(within(first).getByText(/old/).closest('[data-kind]')).toHaveAttribute('data-kind', 'del');
    expect(within(first).getByText(/new/).closest('[data-kind]')).toHaveAttribute('data-kind', 'add');
    expect(screen.getAllByText(/unchanged line/i).length).toBeGreaterThan(0); // the long stretches between are folded
    expect(screen.queryByText('line 1')).toBeNull();
    expect(screen.getByText('line 9')).toBeInTheDocument(); // two lines before the first change
    expect(screen.getByText('mid 1')).toBeInTheDocument(); // and after it
  });

  it('a toggle drops or keeps one change, and says which is which', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const first = document.querySelector('[data-change="0"]') as HTMLElement;
    expect(first).toHaveAttribute('data-kept', 'true');
    fireEvent.click(within(first).getByRole('button', { name: 'Drop' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set([1]));
    expect(document.querySelector('[data-change="0"]')).toHaveAttribute('data-kept', 'false');
    expect(within(document.querySelector('[data-change="0"]') as HTMLElement).getByRole('button', { name: 'Drop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('review-count')).toHaveTextContent('1 of 2 changes kept');
    fireEvent.click(within(document.querySelector('[data-change="0"]') as HTMLElement).getByRole('button', { name: 'Keep' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set([1, 0]));
  });

  it('Keep all and Drop all take every change, and are off when they would change nothing', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByRole('button', { name: 'Drop all' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep all' }));
    expect(screen.getByTestId('review-count')).toHaveTextContent('2 of 2 changes kept');
    expect(screen.getByRole('button', { name: 'Keep all' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Drop all' }));
    expect(screen.getByTestId('review-count')).toHaveTextContent('0 of 2 changes kept');
  });

  it('two texts that are the same to the diff say so, and offer nothing to choose', () => {
    render(<ReviewDiff before={'a\n'} after={'a'} accepted={new Set()} onChange={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent(/No visible change/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the words that changed inside a rewritten line', () => {
    render(<ReviewDiff before="the quick brown fox" after="the slow brown fox" accepted={new Set([0])} onChange={() => undefined} />);
    expect(screen.getByText('quick').tagName).toBe('MARK');
    expect(screen.getByText('slow').tagName).toBe('MARK');
  });
});
