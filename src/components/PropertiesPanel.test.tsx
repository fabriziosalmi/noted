import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PropertiesPanel } from './PropertiesPanel';
import { useStore } from '../store/useStore';
import { setPendingSaveFlusher } from '../lib/pendingSave';

const note = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
const original = window.electronAPI;
let setNoteProperty: ReturnType<typeof vi.fn>;
let flush: ReturnType<typeof vi.fn>;
const notice = vi.fn();

beforeEach(() => {
  flush = vi.fn(async () => undefined);
  setPendingSaveFlusher(flush);
  setNoteProperty = vi.fn(async (name: string, key: string, value: unknown) => {
    const fields = { ...(useStore.getState().frontmatterIndex[name] ?? {}) } as Record<string, unknown>;
    if (value === undefined) delete fields[key]; else fields[key] = value;
    return { success: true, data: { changed: true, fields } };
  });
  window.electronAPI = { ...original, setNoteProperty } as unknown as typeof window.electronAPI;
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en' },
    notes: [note('a.md'), note('Home.md')],
    frontmatterIndex: {
      'a.md': { status: 'open', votes: 3, done: true, tags: ['q4'], parent: '[[Home]]', due: '2026-10-09' },
      'b.md': { status: 'done', due: '2026-10-01', rating: 4 },
    },
  });
});
afterEach(() => { window.electronAPI = original; setPendingSaveFlusher(null); notice.mockClear(); });

const row = (key: string) => document.querySelector(`[data-property="${key}"]`) as HTMLElement;
const panel = () => render(<PropertiesPanel noteName="a.md" onNotice={notice} />);

describe('PropertiesPanel', () => {
  it('asks for a note, and says when there are no properties', () => {
    const { rerender } = render(<PropertiesPanel noteName={null} />);
    expect(screen.getByText('Open a note to see its properties.')).toBeInTheDocument();
    rerender(<PropertiesPanel noteName="nothing.md" />);
    expect(screen.getByText('This note has no properties yet.')).toBeInTheDocument();
  });

  it('shows each property in the editor for its type: text, number, date, checkbox, list, link', () => {
    panel();
    expect(row('status')).toHaveTextContent('open');
    expect(row('votes')).toHaveTextContent('3');
    expect(row('due')).toHaveTextContent('2026-10-09');
    expect(within(row('done')).getByRole('checkbox')).toBeChecked();
    expect(within(row('tags')).getByText('q4')).toBeInTheDocument();
    expect(within(row('parent')).getByRole('button', { name: 'Home' })).toBeInTheDocument(); // a link shows as the note's name
  });

  it('editing a value writes that property, after what is typed in the editor has been saved', async () => {
    panel();
    fireEvent.doubleClick(row('votes').querySelector('[data-field="votes"]') as HTMLElement);
    const input = screen.getByLabelText('votes');
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('a.md', 'votes', 8, { value: 3 }, undefined));
    expect(flush).toHaveBeenCalled();
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(setNoteProperty.mock.invocationCallOrder[0]);
  });

  it('a link is typed as a name and stored as [[name]]; a checkbox toggles', async () => {
    panel();
    fireEvent.doubleClick(row('parent').querySelector('[data-field="parent"]') as HTMLElement);
    const input = screen.getByLabelText('parent');
    fireEvent.change(input, { target: { value: 'Work/Plan' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('a.md', 'parent', '[[Work/Plan]]', { value: '[[Home]]' }, undefined));
    fireEvent.click(within(row('done')).getByRole('checkbox'));
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('a.md', 'done', false, { value: true }, undefined));
  });

  it('removes a property', async () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove property: status' }));
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('a.md', 'status', undefined, { value: 'open' }, undefined));
  });

  it('adds a property: its name suggested from the vault, started as its type, and edited as that type', async () => {
    panel();
    const datalist = document.getElementById('props-known') as HTMLElement;
    expect([...datalist.querySelectorAll('option')].map(o => o.getAttribute('value'))).toEqual(['rating']); // the vault has it, this note does not
    fireEvent.change(screen.getByLabelText('Property name'), { target: { value: 'rating' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'number' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('a.md', 'rating', null, { value: undefined }, undefined));
    await waitFor(() => expect(row('rating')).not.toBeNull());
    fireEvent.doubleClick(row('rating').querySelector('[data-field="rating"]') as HTMLElement);
    expect(screen.getByLabelText('rating')).toHaveAttribute('type', 'number');
    fireEvent.change(screen.getByLabelText('rating'), { target: { value: '5' } });
    fireEvent.keyDown(screen.getByLabelText('rating'), { key: 'Enter' });
    await waitFor(() => expect(setNoteProperty).toHaveBeenLastCalledWith('a.md', 'rating', 5, { value: null }, undefined));
  });

  it('a new checkbox starts unchecked, a new list empty; a name already on the note is not added again', async () => {
    panel();
    fireEvent.change(screen.getByLabelText('Property name'), { target: { value: 'reviewed' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'checkbox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    await waitFor(() => expect(setNoteProperty).toHaveBeenCalledWith('a.md', 'reviewed', false, { value: undefined }, undefined));
    setNoteProperty.mockClear();
    fireEvent.change(screen.getByLabelText('Property name'), { target: { value: 'status' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    expect(setNoteProperty).not.toHaveBeenCalled();
  });

  it('says so when the property could not be changed', async () => {
    setNoteProperty.mockResolvedValueOnce({ success: false, error: 'the properties are not valid YAML' });
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove property: status' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Could not change the property: the properties are not valid YAML', 'error'));
  });
});
