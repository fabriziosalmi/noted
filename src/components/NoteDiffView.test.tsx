import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NoteDiffView } from './NoteDiffView';

describe('NoteDiffView', () => {
  it('highlights the words that changed, on both sides of a rewritten line, and nothing else', () => {
    render(<NoteDiffView before={'# Plan\n\nWe ship **Friday**.\n'} after={'# Plan\n\nWe ship **Monday**.\n'} />);
    const view = screen.getByTestId('note-diff');
    const marks = within(view).getAllByText(/Friday|Monday/, { selector: 'mark' });
    expect(marks.map(m => m.textContent)).toEqual(['Friday', 'Monday']);
    expect(view.querySelectorAll('[data-kind="del"]')).toHaveLength(1);
    expect(view.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    expect(view.querySelectorAll('mark')).toHaveLength(2);
  });

  it('shows the counts, with a readable label', () => {
    render(<NoteDiffView before={'a\nb\n'} after={'a\nc\nd\n'} />);
    expect(screen.getByLabelText('2 lines added, 1 lines removed').textContent).toBe('+2 −1');
  });

  it('collapses long unchanged stretches and says how many lines were left out', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    render(<NoteDiffView before={lines.join('\n')} after={lines.map((l, i) => (i === 20 ? 'CHANGED' : l)).join('\n')} />);
    const view = screen.getByTestId('note-diff');
    expect(view.textContent).toContain('18 unchanged lines'); // before: lines 0-17
    expect(view.textContent).toContain('17 unchanged lines'); // after: lines 23-39
    expect(view.textContent).not.toContain('line 5');
  });

  it('says so when only formatting differs (no text change to show)', () => {
    render(<NoteDiffView before={'same\n'} after={'same\n'} />);
    expect(screen.getByRole('status').textContent).toContain('No visible change');
  });

  it('labels a new and a deleted note', () => {
    const { rerender } = render(<NoteDiffView before="" after={'hello\n'} isNew />);
    expect(screen.getByText('New note')).toBeTruthy();
    expect(screen.getByTestId('note-diff').querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    rerender(<NoteDiffView before={'bye\n'} after="" isDeleted />);
    expect(screen.getByText('Deleted note')).toBeTruthy();
  });

  it('shows text as text, never as markup', () => {
    render(<NoteDiffView before="" after={'<img src=x onerror=alert(1)>\n'} />);
    expect(screen.getByTestId('note-diff').querySelector('img')).toBeNull();
    expect(screen.getByTestId('note-diff').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
