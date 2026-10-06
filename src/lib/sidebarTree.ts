// The sidebar's list, built from the vault's folders at any depth. Pure, so the tree rules (what shows, in which order,
// what a collapsed folder hides, what a search keeps) are tested without a screen.
import { dirnameOf } from '../../shared/vault/paths';
import type { FolderInfo, NoteFile } from '../store/useStore';

export type SortBy = 'date' | 'name' | 'size' | 'custom';

export type SidebarRow =
  | { type: 'root-note'; note: NoteFile; depth: 0 }
  | { type: 'folder-header'; folder: FolderInfo; depth: number; isCollapsed: boolean; isDragTarget: boolean; hasChildren: boolean }
  | { type: 'folder-note'; note: NoteFile; folderName: string; depth: number }
  | { type: 'folder-empty'; folderName: string; depth: number };

export interface TreeInput {
  /** Notes at the vault root, already filtered and sorted. */
  rootNotes: NoteFile[];
  folders: FolderInfo[];
  query: string;
  collapsed: ReadonlySet<string>;
  /** The folder a note or folder is being dragged over. */
  dragOver: string | null;
  sortBy: SortBy;
  customFoldersOrder: readonly string[];
  customNotesOrder: readonly string[];
  pinnedNotes: readonly string[];
}

const matches = (name: string, query: string): boolean => name.toLowerCase().includes(query.toLowerCase());

/** A folder per path, with the folders above every listed one that the list left out ("A/B" implies "A"). */
function withAncestors(folders: readonly FolderInfo[]): Map<string, FolderInfo> {
  const byPath = new Map<string, FolderInfo>(folders.map(f => [f.name, f]));
  for (const folder of folders) {
    for (let at = folder.name.indexOf('/'); at !== -1; at = folder.name.indexOf('/', at + 1)) {
      const ancestor = folder.name.slice(0, at);
      if (!byPath.has(ancestor)) byPath.set(ancestor, { name: ancestor, notes: [] });
    }
  }
  return byPath;
}

export function sortNotes(notes: readonly NoteFile[], input: Pick<TreeInput, 'sortBy' | 'pinnedNotes' | 'customNotesOrder'>): NoteFile[] {
  return [...notes].sort((a, b) => {
    const ap = input.pinnedNotes.includes(a.name) ? 0 : 1;
    const bp = input.pinnedNotes.includes(b.name) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (input.sortBy === 'custom') {
      const idxA = input.customNotesOrder.indexOf(a.name);
      const idxB = input.customNotesOrder.indexOf(b.name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return b.stats.mtimeMs - a.stats.mtimeMs;
    }
    if (input.sortBy === 'name') return a.name.localeCompare(b.name);
    if (input.sortBy === 'size') return b.stats.size - a.stats.size;
    return b.stats.mtimeMs - a.stats.mtimeMs;
  });
}

/**
 * Root notes first, then each top-level folder with its own notes and, under them, its sub-folders, to any depth.
 * A collapsed folder hides everything under it. A search keeps the notes that match and the folders above them (so a
 * match deep down is reachable); a folder with no note of its own and no sub-folder says it is empty.
 */
export function buildSidebarRows(input: TreeInput): SidebarRow[] {
  const rows: SidebarRow[] = input.rootNotes.map(note => ({ type: 'root-note', note, depth: 0 }));
  const byPath = withAncestors(input.folders);

  const children = new Map<string, string[]>();
  for (const path of byPath.keys()) {
    const parent = dirnameOf(path);
    (children.get(parent) ?? children.set(parent, []).get(parent)!).push(path);
  }

  // With a search: only folders that hold a match, directly or below, stay.
  const keep = new Set<string>();
  if (input.query) {
    for (const folder of byPath.values()) {
      if (!folder.notes.some(n => matches(n.name, input.query))) continue;
      for (let path = folder.name; path; path = dirnameOf(path)) keep.add(path);
    }
  }
  const visible = (path: string): boolean => !input.query || keep.has(path);

  const orderFolders = (paths: string[]): string[] => paths.filter(visible).sort((a, b) => {
    if (input.sortBy === 'custom') {
      const idxA = input.customFoldersOrder.indexOf(a);
      const idxB = input.customFoldersOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
    }
    return a.localeCompare(b);
  });

  const emit = (path: string, depth: number): void => {
    const folder = byPath.get(path)!;
    const subfolders = orderFolders(children.get(path) ?? []);
    const isCollapsed = input.collapsed.has(path);
    rows.push({ type: 'folder-header', folder, depth, isCollapsed, isDragTarget: input.dragOver === path, hasChildren: subfolders.length > 0 });
    if (isCollapsed) return;
    const own = input.query ? folder.notes.filter(n => matches(n.name, input.query)) : folder.notes;
    const notes = sortNotes(own, input);
    for (const note of notes) rows.push({ type: 'folder-note', note, folderName: path, depth: depth + 1 });
    if (notes.length === 0 && subfolders.length === 0 && !input.query) rows.push({ type: 'folder-empty', folderName: path, depth: depth + 1 });
    for (const sub of subfolders) emit(sub, depth + 1);
  };

  for (const top of orderFolders(children.get('') ?? [])) emit(top, 0);
  return rows;
}

/** Every folder path under `path` (not `path` itself), for collapsing or counting. */
export function descendantsOf(path: string, folders: readonly FolderInfo[]): string[] {
  return folders.map(f => f.name).filter(name => name.startsWith(`${path}/`));
}

/** How many notes are in a folder and everything under it. */
export function noteCountUnder(path: string, folders: readonly FolderInfo[]): number {
  return folders.filter(f => f.name === path || f.name.startsWith(`${path}/`)).reduce((n, f) => n + f.notes.length, 0);
}
