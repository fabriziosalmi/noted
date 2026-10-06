import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ConnectionsPanel } from './ConnectionsPanel';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
let unlinkedMentions: ReturnType<typeof vi.fn>;
let linkMention: ReturnType<typeof vi.fn>;

const item = (name: string, count = 1, match = 'Quarterly Plan') => ({ name, count, snippet: { before: 'we follow the ', match, after: ' closely' } });

beforeEach(() => {
  unlinkedMentions = vi.fn(async () => ({ success: true, data: { items: [item('A.md', 2), item('Sub/B.md')] } }));
  linkMention = vi.fn(async () => ({ success: true, data: { remaining: 0 } }));
  window.electronAPI = { ...original, unlinkedMentions, linkMention } as unknown as typeof window.electronAPI;
  useStore.setState({ activeNoteName: 'Quarterly Plan.md', noteLinksIndex: {}, noteAliasesIndex: {}, tagIndex: {} });
});
afterEach(() => { window.electronAPI = original; });

describe('unlinked mentions in the connections panel', () => {
  it('lists the notes that mention the open note, with the snippet and the count', async () => {
    render(<ConnectionsPanel onOpenNote={vi.fn()} />);
    const section = await screen.findByTestId('unlinked-mentions');
    expect(unlinkedMentions).toHaveBeenCalledWith('Quarterly Plan.md', undefined);
    expect(within(section).getByText('Unlinked mentions')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('2 mentions')).toBeInTheDocument();
    expect(section.querySelector('mark')!.textContent).toBe('Quarterly Plan');
    expect(section.textContent).toContain('we follow the Quarterly Plan closely');
  });

  it('opens a note from its name', async () => {
    const onOpenNote = vi.fn();
    render(<ConnectionsPanel onOpenNote={onOpenNote} />);
    const section = await screen.findByTestId('unlinked-mentions');
    fireEvent.click(within(section).getByRole('button', { name: 'Sub/B' }));
    expect(onOpenNote).toHaveBeenCalledWith('Sub/B.md');
  });

  it('Link links the first mention, and the note leaves the list: it links to this one now, whatever else it says', async () => {
    render(<ConnectionsPanel onOpenNote={vi.fn()} />);
    const section = await screen.findByTestId('unlinked-mentions');
    fireEvent.click(within(section).getByRole('button', { name: 'Link: A' }));
    await waitFor(() => expect(linkMention).toHaveBeenCalledWith('A.md', 'Quarterly Plan.md', undefined));
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(1));
    expect(within(section).queryByRole('button', { name: 'Link: A' })).toBeNull();
    expect(within(section).getByRole('button', { name: 'Link: Sub/B' })).toBeInTheDocument();
  });

  it('a link that did not go through leaves the list as it was', async () => {
    linkMention.mockResolvedValue({ success: false, error: 'The mention is not there any more' });
    render(<ConnectionsPanel onOpenNote={vi.fn()} />);
    const section = await screen.findByTestId('unlinked-mentions');
    fireEvent.click(within(section).getByRole('button', { name: 'Link: A' }));
    await waitFor(() => expect(linkMention).toHaveBeenCalled());
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows no section when there are no mentions, and ignores an answer for a note that is no longer open', async () => {
    unlinkedMentions.mockResolvedValue({ success: true, data: { items: [] } });
    const { rerender } = render(<ConnectionsPanel onOpenNote={vi.fn()} />);
    await waitFor(() => expect(unlinkedMentions).toHaveBeenCalled());
    expect(screen.queryByTestId('unlinked-mentions')).toBeNull();

    let finish: (v: unknown) => void = () => undefined;
    unlinkedMentions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    useStore.setState({ activeNoteName: 'Slow.md' });
    rerender(<ConnectionsPanel onOpenNote={vi.fn()} />);
    await waitFor(() => expect(unlinkedMentions).toHaveBeenLastCalledWith('Slow.md', undefined));
    useStore.setState({ activeNoteName: 'Fast.md' });
    rerender(<ConnectionsPanel onOpenNote={vi.fn()} />);
    finish({ success: true, data: { items: [item('Stale.md')] } }); // the answer for Slow.md arrives late
    await new Promise(r => setTimeout(r, 600));
    expect(screen.queryByTestId('unlinked-mentions')).toBeNull();
  });
});
