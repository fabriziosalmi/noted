import { describe, expect, it } from 'vitest';
import { buildSidebarRows, descendantsOf, noteCountUnder, type TreeInput } from './sidebarTree';
import type { FolderInfo, NoteFile } from '../store/useStore';

const note = (name: string, mtimeMs = 1000, size = 100): NoteFile => ({ name, path: `/v/${name}`, stats: { mtimeMs, ctimeMs: mtimeMs, size } });
const folder = (name: string, ...notes: NoteFile[]): FolderInfo => ({ name, notes });

const base = (over: Partial<TreeInput> = {}): TreeInput => ({
  rootNotes: [], folders: [], query: '', collapsed: new Set(), dragOver: null, sortBy: 'date',
  customFoldersOrder: [], customNotesOrder: [], pinnedNotes: [], ...over,
});
const shape = (rows: ReturnType<typeof buildSidebarRows>): string[] =>
  rows.map(r => {
    const pad = '  '.repeat(r.depth);
    if (r.type === 'root-note') return `${pad}root:${r.note.name}`;
    if (r.type === 'folder-header') return `${pad}[${r.folder.name}]${r.isCollapsed ? ' (collapsed)' : ''}`;
    if (r.type === 'folder-note') return `${pad}${r.note.name}`;
    return `${pad}(empty ${r.folderName})`;
  });

const tree = [
  folder('Work', note('Work/Plan.md', 5)),
  folder('Work/Q4', note('Work/Q4/Goals.md', 4)),
  folder('Work/Q4/Deep', note('Work/Q4/Deep/Note.md', 3)),
  folder('Life', note('Life/Garden.md', 2)),
];

describe('buildSidebarRows', () => {
  it('lists root notes, then each folder with its own notes and, indented under them, its sub-folders, at any depth', () => {
    expect(shape(buildSidebarRows(base({ rootNotes: [note('Home.md')], folders: tree })))).toEqual([
      'root:Home.md',
      '[Life]', '  Life/Garden.md',
      '[Work]', '  Work/Plan.md',
      '  [Work/Q4]', '    Work/Q4/Goals.md',
      '    [Work/Q4/Deep]', '      Work/Q4/Deep/Note.md',
    ]);
  });

  it('a collapsed folder hides everything under it, and only its own header stays', () => {
    const rows = buildSidebarRows(base({ folders: tree, collapsed: new Set(['Work']) }));
    expect(shape(rows)).toEqual(['[Life]', '  Life/Garden.md', '[Work] (collapsed)']);
    const inner = buildSidebarRows(base({ folders: tree, collapsed: new Set(['Work/Q4']) }));
    expect(shape(inner)).toContain('  [Work/Q4] (collapsed)');
    expect(shape(inner)).not.toContain('    Work/Q4/Goals.md');
    expect(shape(inner)).not.toContain('    [Work/Q4/Deep]');
  });

  it('draws the folders above a listed one even when the list left them out', () => {
    const rows = buildSidebarRows(base({ folders: [folder('A/B/C', note('A/B/C/n.md'))] }));
    expect(shape(rows)).toEqual(['[A]', '  [A/B]', '    [A/B/C]', '      A/B/C/n.md']);
  });

  it('says a folder is empty only when it has no notes and no sub-folders', () => {
    expect(shape(buildSidebarRows(base({ folders: [folder('Empty')] })))).toEqual(['[Empty]', '  (empty Empty)']);
    expect(shape(buildSidebarRows(base({ folders: [folder('Outer'), folder('Outer/Inner')] })))).toEqual([
      '[Outer]', '  [Outer/Inner]', '    (empty Outer/Inner)',
    ]);
  });

  it('a search keeps the notes that match and the folders above them, and drops the rest', () => {
    const rows = buildSidebarRows(base({ folders: tree, query: 'deep' }));
    expect(shape(rows)).toEqual(['[Work]', '  [Work/Q4]', '    [Work/Q4/Deep]', '      Work/Q4/Deep/Note.md']);
    expect(shape(buildSidebarRows(base({ folders: tree, query: 'nothing matches' })))).toEqual([]);
  });

  it('orders folders among their siblings only: custom order by full path, else by name', () => {
    const folders = [folder('B'), folder('A'), folder('A/Z'), folder('A/Y')];
    expect(shape(buildSidebarRows(base({ folders }))).filter(s => s.includes('['))).toEqual(['[A]', '  [A/Y]', '  [A/Z]', '[B]']);
    const custom = buildSidebarRows(base({ folders, sortBy: 'custom', customFoldersOrder: ['B', 'A/Z'] }));
    expect(shape(custom).filter(s => s.includes('['))).toEqual(['[B]', '[A]', '  [A/Z]', '  [A/Y]']);
  });

  it('sorts the notes of a folder, pinned first', () => {
    const folders = [folder('F', note('F/old.md', 1), note('F/new.md', 9), note('F/pinned.md', 0))];
    expect(shape(buildSidebarRows(base({ folders, pinnedNotes: ['F/pinned.md'] }))).slice(1)).toEqual(['  F/pinned.md', '  F/new.md', '  F/old.md']);
    expect(shape(buildSidebarRows(base({ folders, sortBy: 'name' }))).slice(1)).toEqual(['  F/new.md', '  F/old.md', '  F/pinned.md']);
  });

  it('marks the drag target and whether a folder has sub-folders', () => {
    const rows = buildSidebarRows(base({ folders: tree, dragOver: 'Work/Q4' }));
    const header = (path: string) => rows.find(r => r.type === 'folder-header' && r.folder.name === path) as Extract<(typeof rows)[number], { type: 'folder-header' }>;
    expect(header('Work/Q4').isDragTarget).toBe(true);
    expect(header('Work').isDragTarget).toBe(false);
    expect(header('Work').hasChildren).toBe(true);
    expect(header('Life').hasChildren).toBe(false);
  });
});

describe('helpers', () => {
  it('descendantsOf and noteCountUnder count by whole path segments', () => {
    const folders = [...tree, folder('Worker', note('Worker/x.md'))];
    expect(descendantsOf('Work', folders)).toEqual(['Work/Q4', 'Work/Q4/Deep']);
    expect(noteCountUnder('Work', folders)).toBe(3);
    expect(noteCountUnder('Work/Q4', folders)).toBe(2);
    expect(noteCountUnder('Nope', folders)).toBe(0);
  });
});
