import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { NoteFile } from '../store/useStore';

// react-virtual measures the scroll container to decide which rows to render.
// In jsdom the container has zero height, so nothing renders. We stub the
// virtualizer to always return all items so component tests work correctly.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ index: i, start: i * estimateSize() })),
    getTotalSize: () => count * estimateSize(),
  }),
}));

const makeNote = (name: string, mtimeMs = Date.now()): NoteFile => ({
  name,
  path: `/notes/${name}`,
  stats: { mtimeMs, ctimeMs: mtimeMs, size: 100 },
});

// Distinct timestamps so date-sort order is deterministic: gamma (newest) → beta → alpha
const NOTES = [
  makeNote('alpha.md', 1000),
  makeNote('beta.md',  2000),
  makeNote('gamma.md', 3000),
];

const defaults = {
  notes: NOTES,
  activeNoteName: 'alpha.md',
  pinnedNotes: [] as string[],
  onSelectNote: vi.fn(),
  onCreateNote: vi.fn(),
  onDeleteNote: vi.fn(),
  onRenameNote: vi.fn().mockResolvedValue(undefined),
  onTogglePin: vi.fn(),
  onOpenDaily: vi.fn(),
  onOpenSettings: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe('Sidebar', () => {
  it('renders all note names without the .md extension', () => {
    render(<Sidebar {...defaults} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('gamma')).toBeInTheDocument();
  });

  it('calls onSelectNote with the correct filename when a note row is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByText('beta'));
    expect(defaults.onSelectNote).toHaveBeenCalledWith('beta.md');
  });

  it('calls onCreateNote when the + button is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuova nota' }));
    expect(defaults.onCreateNote).toHaveBeenCalled();
  });

  it('calls onDeleteNote with the correct filename when a delete button is clicked', () => {
    render(<Sidebar {...defaults} />);
    // Notes sorted by date desc: gamma(3000), beta(2000), alpha(1000)
    fireEvent.click(screen.getByRole('button', { name: 'Elimina beta.md' }));
    expect(defaults.onDeleteNote).toHaveBeenCalledWith('beta.md');
  });

  it('calls onOpenSettings when the settings footer is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: 'Impostazioni' }));
    expect(defaults.onOpenSettings).toHaveBeenCalled();
  });

  it('applies active style only to the active note', () => {
    render(<Sidebar {...defaults} />);
    // Find the row containing "alpha" text
    const alphaRow = screen.getByText('alpha').closest('[class*="cursor-pointer"]') as HTMLElement;
    const betaRow = screen.getByText('beta').closest('[class*="cursor-pointer"]') as HTMLElement;
    expect(alphaRow.className).toContain('bg-blue-100');
    expect(betaRow.className).not.toContain('bg-blue-100');
  });

  it('renders empty state without crashing when notes is empty', () => {
    render(<Sidebar {...defaults} notes={[]} />);
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });
});
