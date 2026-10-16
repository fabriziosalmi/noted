import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GlobalSearch } from './GlobalSearch';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
let search: ReturnType<typeof vi.fn>;

beforeEach(() => {
  search = vi.fn();
  window.electronAPI = { ...original, searchNotesFulltext: search } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' } });
});
afterEach(() => { window.electronAPI = original; });

const typeQuery = (q: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value: q } });

describe('GlobalSearch', () => {
  it('says a search failed instead of turning the spinner forever', async () => {
    search.mockRejectedValue(new Error('index unavailable'));
    render(<GlobalSearch onSelect={vi.fn()} onClose={vi.fn()} />);
    typeQuery('plan');
    expect(await screen.findByRole('alert')).toHaveTextContent('The search failed: index unavailable');
  });

  it('says how many characters it needs, and finds a deep note with its title still readable', async () => {
    search.mockResolvedValue({ success: true, data: [{ relPath: 'Work/Clients/2026/Q4/Plan.md', title: 'Plan', snippet: 'the plan', score: 1, terms: ['plan'] }] });
    render(<GlobalSearch onSelect={vi.fn()} onClose={vi.fn()} />);
    typeQuery('p');
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();
    typeQuery('plan');
    const row = await screen.findByTitle('Work/Clients/2026/Q4/Plan.md');
    expect(row).toHaveTextContent('Plan');
  });
});
