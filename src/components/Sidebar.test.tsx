import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  noteFolders: [],
  activeNoteName: 'alpha.md',
  pinnedNotes: [] as string[],
  onSelectNote: vi.fn(),
  onCreateNote: vi.fn(),
  onDeleteNote: vi.fn(),
  onRenameNote: vi.fn().mockResolvedValue(undefined),
  onTogglePin: vi.fn(),
  onOpenDaily: vi.fn(),
  onOpenSettings: vi.fn(),
  onCreateFolder: vi.fn().mockResolvedValue(undefined),
  onRenameFolder: vi.fn().mockResolvedValue(undefined),
  onDeleteFolder: vi.fn().mockResolvedValue(undefined),
  onMoveNote: vi.fn().mockResolvedValue(undefined),
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
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    expect(defaults.onCreateNote).toHaveBeenCalled();
  });

  it('calls onDeleteNote with the correct filename when a delete button is clicked', () => {
    const { container } = render(<Sidebar {...defaults} />);
    // Buttons with empty accessible name are [pin,delete] for each row.
    // Sorted by date desc: gamma, beta, alpha -> delete(beta) is index 3.
    const anonymousButtons = container.querySelectorAll('button:not([aria-label]):not([title])');
    fireEvent.click(anonymousButtons[3] as HTMLButtonElement);
    expect(defaults.onDeleteNote).toHaveBeenCalledWith('beta.md');
  });

  it('calls onOpenSettings when the settings footer is clicked', () => {
    const { container } = render(<Sidebar {...defaults} />);
    const settingsTrigger = container.querySelector('div[role="button"][tabindex="0"].p-3');
    fireEvent.click(settingsTrigger as HTMLDivElement);
    expect(defaults.onOpenSettings).toHaveBeenCalled();
  });

  it('applies active style only to the active note', () => {
    render(<Sidebar {...defaults} />);
    // Find the row containing "alpha" text
    const alphaRow = screen.getByText('alpha').closest('[class*="cursor-pointer"]') as HTMLElement;
    const betaRow = screen.getByText('beta').closest('[class*="cursor-pointer"]') as HTMLElement;
    expect(alphaRow.getAttribute('aria-current')).toBe('true');
    expect(betaRow.getAttribute('aria-current')).toBeNull();
  });

  it('renders empty state without crashing when notes is empty', () => {
    render(<Sidebar {...defaults} notes={[]} />);
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('cycles sort mode button label', () => {
    render(<Sidebar {...defaults} />);
    const sortButton = screen.getByTitle(/Sort by:/);
    expect(sortButton).toHaveTextContent('Date');
    fireEvent.click(sortButton);
    expect(sortButton).toHaveTextContent('Name');
    fireEvent.click(sortButton);
    expect(sortButton).toHaveTextContent('Size');
  });

  it('filters notes by search query', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'gam' } });
    expect(screen.getByText('gamma')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('renames a note on double click + Enter', async () => {
    const onRenameNote = vi.fn().mockResolvedValue(undefined);
    render(<Sidebar {...defaults} onRenameNote={onRenameNote} />);
    fireEvent.doubleClick(screen.getByText('alpha'));
    const input = screen.getByDisplayValue('alpha');
    fireEvent.change(input, { target: { value: 'alpha-new' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onRenameNote).toHaveBeenCalledWith('alpha.md', 'alpha-new.md');
    });
  });

  it('opens tags panel and toggles a tag filter', () => {
    const onTagFilter = vi.fn();
    render(
      <Sidebar
        {...defaults}
        allTags={['work', 'idea']}
        activeTagFilter={null}
        onTagFilter={onTagFilter}
      />
    );
    fireEvent.click(screen.getByTitle('Tags'));
    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(onTagFilter).toHaveBeenCalledWith('work');
  });

  it('creates folder from inline input', async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    render(<Sidebar {...defaults} onCreateFolder={onCreateFolder} />);
    fireEvent.click(screen.getByTitle('New folder'));
    const input = screen.getByPlaceholderText('Folder name...');
    fireEvent.change(input, { target: { value: 'docs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await Promise.resolve();
    expect(onCreateFolder).toHaveBeenCalledWith('docs');
  });

  it('toggles folder collapse by click', () => {
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} />);
    expect(screen.getByText('zeta')).toBeInTheDocument();
    fireEvent.click(screen.getByText('docs'));
    expect(screen.queryByText('zeta')).not.toBeInTheDocument();
  });

  it('creates note in folder from folder action', () => {
    const onCreateNote = vi.fn();
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onCreateNote={onCreateNote} />);
    fireEvent.click(screen.getByTitle('New note here'));
    expect(onCreateNote).toHaveBeenCalledWith('docs');
  });

  it('deletes folder when confirmed', async () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onDeleteFolder={onDeleteFolder} />);
    fireEvent.click(screen.getByTitle('Delete folder'));
    await Promise.resolve();
    expect(onDeleteFolder).toHaveBeenCalledWith('docs');
    confirmSpy.mockRestore();
  });

  it('does not delete folder when confirm is cancelled', async () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onDeleteFolder={onDeleteFolder} />);
    fireEvent.click(screen.getByTitle('Delete folder'));
    await Promise.resolve();
    expect(onDeleteFolder).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('renames a folder on double click + Enter', async () => {
    const onRenameFolder = vi.fn().mockResolvedValue(undefined);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onRenameFolder={onRenameFolder} />);
    fireEvent.doubleClick(screen.getByText('docs'));
    const input = screen.getByDisplayValue('docs');
    fireEvent.change(input, { target: { value: 'docs-new' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onRenameFolder).toHaveBeenCalledWith('docs', 'docs-new');
    });
  });

  it('moves note to folder via drag and drop', async () => {
    const onMoveNote = vi.fn().mockResolvedValue(undefined);
    const rootNote = makeNote('root.md', 1000);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[rootNote, makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onMoveNote={onMoveNote} />);
    const row = screen.getByText('root').closest('[draggable="true"]') as HTMLElement;
    const folderHeader = screen.getByText('docs').closest('div[role="button"]')?.parentElement as HTMLElement;
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue('root.md'),
    };
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragOver(folderHeader, { dataTransfer });
    fireEvent.drop(folderHeader, { dataTransfer });
    await waitFor(() => {
      expect(onMoveNote).toHaveBeenCalledWith('root.md', 'docs');
    });
  });

  it('renders empty state for active tag filter', () => {
    render(<Sidebar {...defaults} notes={[]} noteFolders={[]} activeTagFilter="work" />);
    expect(screen.getByText('No notes with work')).toBeInTheDocument();
  });

  it('renders empty state for search with no results', () => {
    render(<Sidebar {...defaults} notes={[]} noteFolders={[]} />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'missing' } });
    expect(screen.getByText('No notes found')).toBeInTheDocument();
  });

  it('toggles folder collapse with keyboard Enter', () => {
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} />);
    const header = screen.getByText('docs').closest('div[role="button"]') as HTMLElement;
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(screen.queryByText('zeta')).not.toBeInTheDocument();
  });

  it('cancels note rename on Escape', () => {
    const onRenameNote = vi.fn().mockResolvedValue(undefined);
    render(<Sidebar {...defaults} onRenameNote={onRenameNote} />);
    fireEvent.doubleClick(screen.getByText('alpha'));
    const input = screen.getByDisplayValue('alpha');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameNote).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('alpha')).not.toBeInTheDocument();
  });

  it('cancels folder rename on Escape', () => {
    const onRenameFolder = vi.fn().mockResolvedValue(undefined);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onRenameFolder={onRenameFolder} />);
    fireEvent.doubleClick(screen.getByText('docs'));
    const input = screen.getByDisplayValue('docs');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameFolder).not.toHaveBeenCalled();
  });

  it('does not move note when dropping to same folder or missing payload', async () => {
    const onMoveNote = vi.fn().mockResolvedValue(undefined);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onMoveNote={onMoveNote} />);
    const folderContainer = screen.getByText('docs').closest('div[role="button"]')?.parentElement as HTMLElement;

    fireEvent.drop(folderContainer, {
      dataTransfer: { getData: () => '' },
    });
    await Promise.resolve();
    expect(onMoveNote).not.toHaveBeenCalled();

    fireEvent.drop(folderContainer, {
      dataTransfer: { getData: () => 'docs/zeta.md' },
    });
    await Promise.resolve();
    expect(onMoveNote).not.toHaveBeenCalled();
  });

  it('folder action mousedown does not collapse folder (stopPropagation)', () => {
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} />);
    expect(screen.getByText('zeta')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTitle('New note here'));
    expect(screen.getByText('zeta')).toBeInTheDocument();
  });

  it('clears drag highlight on global dragend', () => {
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} />);
    const folderContainer = screen.getByText('docs').closest('div[role="button"]')?.parentElement as HTMLElement;

    fireEvent.dragOver(folderContainer);
    expect(folderContainer.className).toContain('ring-1');

    fireEvent.dragEnd(window);
    expect(folderContainer.className).not.toContain('ring-1');
  });

  it('opens settings via keyboard Enter and Space', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(<Sidebar {...defaults} onOpenSettings={onOpenSettings} />);
    const settingsTrigger = container.querySelector('div[role="button"][tabindex="0"].p-3') as HTMLElement;
    fireEvent.keyDown(settingsTrigger, { key: 'Enter' });
    fireEvent.keyDown(settingsTrigger, { key: ' ' });
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });
});
