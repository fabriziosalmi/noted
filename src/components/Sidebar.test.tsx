import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '../test/test-utils';
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

  it('deletes a note (with the correct filename) after confirming', async () => {
    render(<Sidebar {...defaults} />);
    // One "Delete note" button per row; sorted by date desc: gamma, beta, alpha.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete note' });
    fireEvent.click(deleteButtons[1]);
    // A confirmation dialog now guards the destructive action.
    expect(defaults.onDeleteNote).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(defaults.onDeleteNote).toHaveBeenCalledWith('beta.md'));
  });

  it('calls onOpenSettings when the settings footer is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
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
    const sortButton = screen.getByRole('button', { name: /Sort by:/ });
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
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(onTagFilter).toHaveBeenCalledWith('work');
  });

  it('creates folder from inline input', async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    render(<Sidebar {...defaults} onCreateFolder={onCreateFolder} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'New note here' }));
    expect(onCreateNote).toHaveBeenCalledWith('docs');
  });

  it('deletes folder when confirmed', async () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onDeleteFolder={onDeleteFolder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    await waitFor(() => expect(onDeleteFolder).toHaveBeenCalledWith('docs'));
  });

  it('does not delete folder when confirm is cancelled', async () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} onDeleteFolder={onDeleteFolder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDeleteFolder).not.toHaveBeenCalled();
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
    const folderHeader = screen.getByText('docs').closest('[draggable="true"]')?.parentElement as HTMLElement;
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
    // The folder toggle is now a native <button>, which is inherently
    // keyboard-operable (Enter/Space → click). jsdom does not synthesize the
    // click from a raw keyDown, so we assert via the accessible control.
    const header = screen.getByRole('button', { name: 'docs' });
    fireEvent.click(header);
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
    const folderContainer = screen.getByText('docs').closest('[draggable="true"]')?.parentElement as HTMLElement;

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
    fireEvent.mouseDown(screen.getByRole('button', { name: 'New note here' }));
    expect(screen.getByText('zeta')).toBeInTheDocument();
  });

  it('clears drag highlight on global dragend', () => {
    const foldered = [{ name: 'docs', notes: [makeNote('docs/zeta.md', 1000)] }];
    render(<Sidebar {...defaults} notes={[makeNote('docs/zeta.md', 1000)]} noteFolders={foldered} />);
    const folderContainer = screen.getByText('docs').closest('[draggable="true"]')?.parentElement as HTMLElement;

    fireEvent.dragOver(folderContainer);
    expect(folderContainer.className).toContain('ring-1');

    fireEvent.dragEnd(window);
    expect(folderContainer.className).not.toContain('ring-1');
  });

  it('opens settings from the footer control', () => {
    const onOpenSettings = vi.fn();
    // The footer is now a single native <button> — inherently keyboard-operable
    // (Enter/Space → click), which jsdom does not synthesize from raw keyDown,
    // so we assert activation via the accessible control.
    render(<Sidebar {...defaults} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  describe('notes and folders at depth', () => {
    const deepNote = makeNote('Work/Q4/Goals.md', 1000);
    const deepFolders = [{ name: 'Work/Q4', notes: [deepNote] }]; // "Work" is implied
    const folderBox = (label: string) => screen.getByText(label).closest('[draggable="true"]')?.parentElement as HTMLElement;
    const dragData = (value: string, type = 'text/note-name') => ({
      types: [type],
      getData: (t: string) => (t === type ? value : ''),
      setData: vi.fn(),
    });

    it('draws a nested folder under its parent, by its own name and indented', () => {
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} />);
      expect(screen.getByText('Work')).toBeInTheDocument();
      expect(screen.getByText('Q4')).toBeInTheDocument();
      expect(screen.getByText('Q4').getAttribute('title')).toBe('Work/Q4');
      const padOf = (el: HTMLElement): string => (el.closest('[style*="translateY"]') as HTMLElement).style.paddingLeft;
      expect(padOf(screen.getByText('Work'))).toBe('0px');
      expect(padOf(screen.getByText('Q4'))).toBe('12px');
      expect(padOf(screen.getByText('Goals'))).toBe('24px');
    });

    it('collapsing a folder hides the folders and notes under it', () => {
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} />);
      fireEvent.click(screen.getByText('Work'));
      expect(screen.queryByText('Q4')).toBeNull();
      expect(screen.queryByText('Goals')).toBeNull();
      fireEvent.click(screen.getByText('Work'));
      expect(screen.getByText('Goals')).toBeInTheDocument();
    });

    it('a search keeps the folders above a match', () => {
      render(<Sidebar {...defaults} notes={[deepNote, makeNote('other.md', 2000)]} noteFolders={deepFolders} />);
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'goals' } });
      expect(screen.getByText('Work')).toBeInTheDocument();
      expect(screen.getByText('Q4')).toBeInTheDocument();
      expect(screen.getByText('Goals')).toBeInTheDocument();
      expect(screen.queryByText('other')).toBeNull();
    });

    it('makes a new folder inside a folder, with its parent in the path', async () => {
      const onCreateFolder = vi.fn().mockResolvedValue(undefined);
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} onCreateFolder={onCreateFolder} />);
      const box = folderBox('Q4');
      fireEvent.click(within(box).getByLabelText('New folder inside'));
      const input = screen.getByPlaceholderText('New folder in Work/Q4');
      fireEvent.change(input, { target: { value: 'Retro' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith('Work/Q4/Retro'));
    });

    it('renames a note in a nested folder inside that folder, not in the top-level one', async () => {
      const onRenameNote = vi.fn().mockResolvedValue(undefined);
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} onRenameNote={onRenameNote} />);
      fireEvent.doubleClick(screen.getByText('Goals'));
      const input = screen.getByDisplayValue('Goals');
      fireEvent.change(input, { target: { value: 'Targets' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(onRenameNote).toHaveBeenCalledWith('Work/Q4/Goals.md', 'Work/Q4/Targets.md'));
    });

    it('names the note, not "Q4/Goals", when asking to delete it', async () => {
      const onDeleteNote = vi.fn();
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} onDeleteNote={onDeleteNote} />);
      const row = screen.getByText('Goals').closest('[draggable="true"]') as HTMLElement;
      fireEvent.mouseEnter(row);
      fireEvent.click(within(row.parentElement as HTMLElement).getByLabelText('Delete note'));
      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('"Goals"');
      expect(dialog.textContent).not.toContain('Q4/Goals');
    });

    it('renames a nested folder keeping its parent: the field holds its own name, the call gets the whole path', async () => {
      const onRenameFolder = vi.fn().mockResolvedValue(undefined);
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} onRenameFolder={onRenameFolder} />);
      fireEvent.doubleClick(screen.getByText('Q4'));
      const input = screen.getByDisplayValue('Q4');
      fireEvent.change(input, { target: { value: 'Q5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(onRenameFolder).toHaveBeenCalledWith('Work/Q4', 'Work/Q5'));
    });

    it('does not move a note dropped on the folder it is already in, however deep', async () => {
      const onMoveNote = vi.fn().mockResolvedValue(undefined);
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} onMoveNote={onMoveNote} />);
      fireEvent.drop(folderBox('Q4'), { dataTransfer: dragData('Work/Q4/Goals.md') });
      await Promise.resolve();
      expect(onMoveNote).not.toHaveBeenCalled();
    });

    it('moves a note from the root into a nested folder, by the folder\'s whole path', async () => {
      const onMoveNote = vi.fn().mockResolvedValue(undefined);
      render(<Sidebar {...defaults} notes={[makeNote('root.md', 2000), deepNote]} noteFolders={deepFolders} onMoveNote={onMoveNote} />);
      fireEvent.drop(folderBox('Q4'), { dataTransfer: dragData('root.md') });
      await waitFor(() => expect(onMoveNote).toHaveBeenCalledWith('root.md', 'Work/Q4'));
    });

    // The middle of a folder header means "into it"; jsdom has no layout, so the header's box is given by hand.
    const overMiddle = (el: HTMLElement) => {
      el.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
      return { clientY: 20 };
    };

    it('drops a folder into another folder: it moves, keeping its own name', async () => {
      const onRenameFolder = vi.fn().mockResolvedValue(undefined);
      const folders = [{ name: 'Life', notes: [makeNote('Life/Garden.md', 1)] }, ...deepFolders];
      render(<Sidebar {...defaults} notes={[deepNote, makeNote('Life/Garden.md', 1)]} noteFolders={folders} onRenameFolder={onRenameFolder} />);
      const target = folderBox('Life');
      const point = overMiddle(target);
      const dataTransfer = dragData('Work/Q4', 'text/folder-name');
      fireEvent.dragOver(target, { dataTransfer, ...point });
      fireEvent.drop(target, { dataTransfer, ...point });
      await waitFor(() => expect(onRenameFolder).toHaveBeenCalledWith('Work/Q4', 'Life/Q4'));
    });

    it('never drops a folder into itself or what is under it', async () => {
      const onRenameFolder = vi.fn().mockResolvedValue(undefined);
      const folders = [...deepFolders, { name: 'Work/Q4/Deep', notes: [makeNote('Work/Q4/Deep/n.md', 1)] }];
      render(<Sidebar {...defaults} notes={[deepNote, makeNote('Work/Q4/Deep/n.md', 1)]} noteFolders={folders} onRenameFolder={onRenameFolder} />);
      const target = folderBox('Deep');
      const point = overMiddle(target);
      const dataTransfer = dragData('Work/Q4', 'text/folder-name');
      fireEvent.dragOver(target, { dataTransfer, ...point });
      fireEvent.drop(target, { dataTransfer, ...point });
      await Promise.resolve();
      expect(onRenameFolder).not.toHaveBeenCalled();
    });

    it('drops a folder on the list itself to bring it to the top level', async () => {
      const onRenameFolder = vi.fn().mockResolvedValue(undefined);
      render(<Sidebar {...defaults} notes={[deepNote]} noteFolders={deepFolders} onRenameFolder={onRenameFolder} />);
      const list = screen.getByText('Work').closest('.overflow-y-auto') as HTMLElement;
      fireEvent.drop(list, { dataTransfer: dragData('Work/Q4', 'text/folder-name') });
      await waitFor(() => expect(onRenameFolder).toHaveBeenCalledWith('Work/Q4', 'Q4'));
    });
  });
});
