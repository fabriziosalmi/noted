import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  FileText, Plus, Trash2, Settings, Search, ArrowUpDown, Star, CalendarDays,
  Tag, X, FolderOpen, Folder, FolderPlus, ChevronRight, ChevronDown
} from 'lucide-react';
import type { NoteFile, FolderInfo } from '../store/useStore';
import { useStore } from '../store/useStore';
import { useI18n } from '../lib/i18n';

type SortBy = 'date' | 'name' | 'size' | 'custom';

type SidebarRow =
  | { type: 'root-note'; note: NoteFile }
  | { type: 'folder-header'; folder: FolderInfo; isCollapsed: boolean; isDragTarget: boolean }
  | { type: 'folder-note'; note: NoteFile; folderName: string }
  | { type: 'folder-empty'; folderName: string };

interface SidebarProps {
  notes: NoteFile[];                     // flat (all notes for search)
  noteFolders: FolderInfo[];
  activeNoteName: string | null;
  pinnedNotes: string[];
  onSelectNote: (name: string) => void;
  onCreateNote: (folder?: string) => void;
  onDeleteNote: (name: string) => void;
  onRenameNote: (oldName: string, newName: string) => Promise<void>;
  onTogglePin: (name: string) => void;
  onOpenDaily: () => void;
  onOpenSettings: () => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (oldName: string, newName: string) => Promise<void>;
  onDeleteFolder: (name: string) => Promise<void>;
  onMoveNote: (fileName: string, toFolder: string) => Promise<void>;
  allTags?: string[];
  activeTagFilter?: string | null;
  onTagFilter?: (tag: string | null) => void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return `${Math.floor(diff / 604_800_000)}w`;
}

function getNoteCounterText(count: number, language: string): string {
  if (language === 'it') {
    return count === 1 ? '1 nota' : `${count} note`;
  }
  if (language === 'de') {
    return count === 1 ? '1 Notiz' : `${count} Notizen`;
  }
  if (language === 'es') {
    return count === 1 ? '1 nota' : `${count} notas`;
  }
  if (language === 'pt') {
    return count === 1 ? '1 nota' : `${count} notas`;
  }
  if (language === 'fr') {
    return (count === 1 || count === 0) ? `${count} note` : `${count} notes`;
  }
  return count === 1 ? '1 note' : `${count} notes`;
}

function NoteRow({
  note, isActive, isPinned, isRenaming, renameValue, renameInputRef,
  onSelect, onDelete, onTogglePin, onStartRename, onRenameChange, onRenameBlur, onRenameKeyDown,
  onDragStart, renameHint,
}: {
  note: NoteFile; isActive: boolean; isPinned: boolean; isRenaming: boolean;
  renameValue: string; renameInputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: () => void; onDelete: () => void; onTogglePin: () => void;
  onStartRename: (e: React.MouseEvent) => void;
  onRenameChange: (v: string) => void; onRenameBlur: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  renameHint: string;
}) {
  const baseName = note.name.includes('/') ? note.name.split('/').pop()! : note.name;
  return (
    <div
      role="button" tabIndex={isRenaming ? -1 : 0}
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onClick={() => !isRenaming && onSelect()}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.repeat) return;
        if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); }
      }}
      aria-current={isActive ? 'true' : undefined}
      className={`relative flex items-center justify-between p-2 rounded text-sm cursor-pointer mb-0.5 group transition-all duration-150 ease-out pl-4 ${
        isActive
          ? 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)] font-medium sidebar-note-active'
          : 'hover:bg-gray-200/50 dark:hover:bg-gray-800/40 text-gray-700 dark:text-gray-300'
      }`}
    >
      <span className="sidebar-note-indicator" />
      <div className="flex items-center space-x-2 truncate flex-1 min-w-0">
        <FileText size={14} className="shrink-0 opacity-70" />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onRenameBlur}
            onKeyDown={onRenameKeyDown}
            onClick={e => e.stopPropagation()}
            className="flex-1 min-w-0 bg-white dark:bg-gray-700 border border-[var(--accent)] rounded px-1 text-xs outline-none"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        ) : (
          <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
            <span className="truncate" onDoubleClick={onStartRename} title={renameHint}>
              {baseName.replace('.md', '')}
            </span>
            <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-600 leading-none">
              {relativeTime(note.stats.mtimeMs)}
            </span>
          </div>
        )}
      </div>
      {!isRenaming && (
        <div className="flex items-center shrink-0">
          <button onClick={e => { e.stopPropagation(); onTogglePin(); }}
            className={`p-1 transition-colors animate-spring-scale ${isPinned ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-400'}`}>
            <Star size={11} fill={isPinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1 animate-spring-scale">
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  notes, noteFolders, activeNoteName, pinnedNotes,
  onSelectNote, onCreateNote, onDeleteNote, onRenameNote, onTogglePin, onOpenDaily, onOpenSettings,
  onCreateFolder, onRenameFolder, onDeleteFolder, onMoveNote,
  allTags = [], activeTagFilter = null, onTagFilter,
}: SidebarProps) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  
  const sortBy = useStore(state => state.sortBy);
  const [appVersion, setAppVersion] = useState('1.0.12');

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(setAppVersion).catch(() => {});
    }
  }, []);
  const setSortBy = useStore(state => state.setSortBy);
  const customNotesOrder = useStore(state => state.customNotesOrder);
  const customFoldersOrder = useStore(state => state.customFoldersOrder);
  const setCustomNotesOrder = useStore(state => state.setCustomNotesOrder);
  const setCustomFoldersOrder = useStore(state => state.setCustomFoldersOrder);

  const [renamingNote, setRenamingNote] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const SORT_LABELS: Record<SortBy, string> = {
    date: t('sortDate'),
    name: t('sortName'),
    size: t('sortSize'),
    custom: t('custom'),
  };

  const [showTags, setShowTags] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  
  const [dragOver, setDragOver] = useState<string | null>(null); // folder name or 'root'
  const [dragOverFolderHeader, setDragOverFolderHeader] = useState<string | null>(null);
  const [dragOverFolderPosition, setDragOverFolderPosition] = useState<'before' | 'after' | null>(null);
  const [dragOverNote, setDragOverNote] = useState<string | null>(null);
  const [dragOverNotePosition, setDragOverNotePosition] = useState<'before' | 'after' | null>(null);

  useEffect(() => {
    const clearDragState = () => {
      setDragOver(null);
      setDragOverFolderHeader(null);
      setDragOverFolderPosition(null);
      setDragOverNote(null);
      setDragOverNotePosition(null);
    };
    window.addEventListener('dragend', clearDragState);
    window.addEventListener('drop', clearDragState);
    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('drop', clearDragState);
    };
  }, []);

  const cycleSortBy = useCallback(() => {
    let next: SortBy;
    if (sortBy === 'custom') next = 'date';
    else if (sortBy === 'date') next = 'name';
    else if (sortBy === 'name') next = 'size';
    else next = 'custom';
    setSortBy(next);
  }, [sortBy, setSortBy]);

  const toggleFolder = (name: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  };

  // Root notes (no folder prefix)
  const rootNotes = useMemo(() => {
    const root = notes.filter(n => !n.name.includes('/'));
    return (query
      ? root.filter(n => n.name.toLowerCase().includes(query.toLowerCase()))
      : root
    ).sort((a, b) => {
      const ap = pinnedNotes.includes(a.name) ? 0 : 1;
      const bp = pinnedNotes.includes(b.name) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      
      if (sortBy === 'custom') {
        const idxA = customNotesOrder.indexOf(a.name);
        const idxB = customNotesOrder.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return b.stats.mtimeMs - a.stats.mtimeMs;
      }
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.stats.size - a.stats.size;
      return b.stats.mtimeMs - a.stats.mtimeMs;
    });
  }, [notes, query, sortBy, pinnedNotes, customNotesOrder]);

  // Commits rename
  const commitNoteRename = useCallback(async () => {
    if (!renamingNote || !renameValue.trim()) { setRenamingNote(null); return; }
    const baseName = renamingNote.includes('/') ? renamingNote.split('/')[0] + '/' : '';
    const stem = renameValue.trim().replace(/\.md$/i, '');
    const fullNew = baseName + stem + '.md';
    if (fullNew === renamingNote) { setRenamingNote(null); return; }
    try { await onRenameNote(renamingNote, fullNew); } catch { /* toast upstream */ }
    finally { setRenamingNote(null); }
  }, [renamingNote, renameValue, onRenameNote]);

  const commitFolderRename = useCallback(async () => {
    if (!renamingFolder || !folderRenameValue.trim()) { setRenamingFolder(null); return; }
    if (folderRenameValue.trim() === renamingFolder) { setRenamingFolder(null); return; }
    try { await onRenameFolder(renamingFolder, folderRenameValue.trim()); } catch { /* toast */ }
    finally { setRenamingFolder(null); }
  }, [renamingFolder, folderRenameValue, onRenameFolder]);

  const commitNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    setNewFolderMode(false); setNewFolderName('');
    if (!name) return;
    try { await onCreateFolder(name); } catch { /* toast */ }
  }, [newFolderName, onCreateFolder]);

  // Drag helpers
  const isDraggingFolder = (types: readonly string[] | DOMStringList | undefined) =>
    types ? Array.from(types).includes('text/folder-name') : false;
  const isDraggingNote = (types: readonly string[] | DOMStringList | undefined) =>
    types ? Array.from(types).includes('text/note-name') : false;

  const handleDragStart = (e: React.DragEvent, noteName: string) => {
    e.dataTransfer?.setData('text/note-name', noteName);
  };

  const handleDrop = async (e: React.DragEvent, toFolder: string) => {
    e.preventDefault();
    setDragOver(null);
    const noteName = e.dataTransfer?.getData('text/note-name');
    if (!noteName) return;
    const currentFolder = noteName.includes('/') ? noteName.split('/')[0] : '';
    if (currentFolder === toFolder) return;
    try {
      await onMoveNote(noteName, toFolder);
      setSortBy('custom');
    } catch { /* toast */ }
  };

  const handleFolderDragOver = (e: React.DragEvent, targetFolderName: string) => {
    const types = e.dataTransfer?.types;
    if (!types || isDraggingNote(types)) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(targetFolderName);
      setDragOverFolderHeader(null);
      setDragOverFolderPosition(null);
    } else if (isDraggingFolder(types)) {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const position = relativeY < rect.height / 2 ? 'before' : 'after';
      setDragOverFolderHeader(targetFolderName);
      setDragOverFolderPosition(position);
      setDragOver(null);
    }
  };

  const handleFolderDrop = async (e: React.DragEvent, targetFolderName: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const types = e.dataTransfer?.types;
    const isFolder = types ? isDraggingFolder(types) : false;
    
    const position = dragOverFolderPosition;
    setDragOverFolderHeader(null);
    setDragOverFolderPosition(null);
    setDragOver(null);
    
    if (isFolder) {
      const folderName = e.dataTransfer?.getData('text/folder-name');
      if (folderName && folderName !== targetFolderName) {
        const order = [...customFoldersOrder];
        const allFolderNames = noteFolders.map(f => f.name);
        for (const fName of allFolderNames) {
          if (!order.includes(fName)) {
            order.push(fName);
          }
        }
        const fromIndex = order.indexOf(folderName);
        let toIndex = order.indexOf(targetFolderName);
        if (fromIndex !== -1 && toIndex !== -1) {
          order.splice(fromIndex, 1);
          toIndex = order.indexOf(targetFolderName);
          if (position === 'after') {
            order.splice(toIndex + 1, 0, folderName);
          } else {
            order.splice(toIndex, 0, folderName);
          }
          setCustomFoldersOrder(order);
          setSortBy('custom');
        }
      }
    } else {
      const noteName = e.dataTransfer?.getData('text/note-name');
      if (noteName) {
        const currentFolder = noteName.includes('/') ? noteName.split('/')[0] : '';
        if (currentFolder === targetFolderName) return;
        try {
          await onMoveNote(noteName, targetFolderName);
          setSortBy('custom');
        } catch { /* toast */ }
      }
    }
  };

  const handleNoteDragOver = (e: React.DragEvent, targetNote: NoteFile) => {
    const types = e.dataTransfer?.types;
    if (!types || isDraggingNote(types)) {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const position = relativeY < rect.height / 2 ? 'before' : 'after';
      setDragOverNote(targetNote.name);
      setDragOverNotePosition(position);
    }
  };

  const handleNoteDragLeave = () => {
    setDragOverNote(null);
    setDragOverNotePosition(null);
  };

  const handleNoteDrop = async (e: React.DragEvent, targetNote: NoteFile, folderName: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const noteName = e.dataTransfer?.getData('text/note-name');
    const position = dragOverNotePosition;
    setDragOverNote(null);
    setDragOverNotePosition(null);
    
    if (!noteName || noteName === targetNote.name) return;
    
    const currentFolder = noteName.includes('/') ? noteName.split('/')[0] : '';
    let finalNoteName = noteName;
    if (currentFolder !== folderName) {
      try {
        await onMoveNote(noteName, folderName);
        const stem = noteName.includes('/') ? noteName.split('/').pop()! : noteName;
        finalNoteName = folderName ? `${folderName}/${stem}` : stem;
      } catch {
        return;
      }
    }
    
    const latestOrder = useStore.getState().customNotesOrder;
    const order = [...latestOrder];
    const allNoteNames = notes.map(n => n.name);
    for (const name of allNoteNames) {
      if (!order.includes(name)) {
        order.push(name);
      }
    }
    
    const fromIndex = order.indexOf(finalNoteName);
    let toIndex = order.indexOf(targetNote.name);
    if (fromIndex !== -1 && toIndex !== -1) {
      order.splice(fromIndex, 1);
      toIndex = order.indexOf(targetNote.name);
      if (position === 'after') {
        order.splice(toIndex + 1, 0, finalNoteName);
      } else {
        order.splice(toIndex, 0, finalNoteName);
      }
      setCustomNotesOrder(order);
      setSortBy('custom');
    }
  };

  const renderNote = (note: NoteFile, folderName = '') => {
    const isDragOverTarget = dragOverNote === note.name;
    const dragOverPos = isDragOverTarget ? dragOverNotePosition : null;

    return (
      <div
        onDragOver={e => handleNoteDragOver(e, note)}
        onDragLeave={handleNoteDragLeave}
        onDrop={e => void handleNoteDrop(e, note, folderName)}
        style={{
          boxShadow: dragOverPos === 'before'
            ? 'inset 0 2px 0 var(--accent)'
            : dragOverPos === 'after'
            ? 'inset 0 -2px 0 var(--accent)'
            : undefined,
        }}
      >
        <NoteRow
          key={note.name}
          note={note}
          isActive={activeNoteName === note.name}
          isPinned={pinnedNotes.includes(note.name)}
          isRenaming={renamingNote === note.name}
          renameValue={renameValue}
          renameInputRef={renameInputRef}
          onSelect={() => onSelectNote(note.name)}
          onDelete={() => onDeleteNote(note.name)}
          onTogglePin={() => onTogglePin(note.name)}
          onStartRename={e => { e.stopPropagation(); setRenamingNote(note.name); setRenameValue(note.name.replace(/^[^/]+\//, '').replace('.md', '')); setTimeout(() => renameInputRef.current?.select(), 0); }}
          onRenameChange={setRenameValue}
          onRenameBlur={() => void commitNoteRename()}
          onRenameKeyDown={e => {
            if (e.nativeEvent.isComposing || e.repeat) return;
            if (e.key === 'Enter') { e.preventDefault(); void commitNoteRename(); }
            if (e.key === 'Escape') setRenamingNote(null);
          }}
          onDragStart={e => handleDragStart(e, note.name)}
          renameHint={t('renameHint')}
        />
      </div>
    );
  };

  const parentRef = useRef<HTMLDivElement>(null);

  // Flat rows calculation for virtualization
  const rows = useMemo<SidebarRow[]>(() => {
    const list: SidebarRow[] = [];

    // 1. Add root notes
    for (const note of rootNotes) {
      list.push({
        type: 'root-note',
        note,
      });
    }

    // 2. Add folder rows and their contents
    const filteredFolders = noteFolders.filter(
      f => !query || f.notes.some(n => n.name.toLowerCase().includes(query.toLowerCase()))
    );

    const foldersSorted = [...filteredFolders].sort((a, b) => {
      if (sortBy === 'custom') {
        const idxA = customFoldersOrder.indexOf(a.name);
        const idxB = customFoldersOrder.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

    for (const folder of foldersSorted) {
      const isCollapsed = collapsedFolders.has(folder.name);
      const isDragTarget = dragOver === folder.name;
      const filteredFolderNotes = query
        ? folder.notes.filter(n => n.name.toLowerCase().includes(query.toLowerCase()))
        : folder.notes;

      const sortedFolderNotes = [...filteredFolderNotes].sort((a, b) => {
        const ap = pinnedNotes.includes(a.name) ? 0 : 1;
        const bp = pinnedNotes.includes(b.name) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        if (sortBy === 'custom') {
          const idxA = customNotesOrder.indexOf(a.name);
          const idxB = customNotesOrder.indexOf(b.name);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return b.stats.mtimeMs - a.stats.mtimeMs;
        }
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'size') return b.stats.size - a.stats.size;
        return b.stats.mtimeMs - a.stats.mtimeMs;
      });

      list.push({
        type: 'folder-header',
        folder,
        isCollapsed,
        isDragTarget,
      });

      if (!isCollapsed) {
        for (const note of sortedFolderNotes) {
          list.push({
            type: 'folder-note',
            note,
            folderName: folder.name,
          });
        }
        if (sortedFolderNotes.length === 0 && !query) {
          list.push({
            type: 'folder-empty',
            folderName: folder.name,
          });
        }
      }
    }

    return list;
  }, [rootNotes, noteFolders, query, collapsedFolders, dragOver, sortBy, customNotesOrder, customFoldersOrder, pinnedNotes]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback((index: number) => {
      const row = rows[index];
      if (!row) return 32;
      if (row.type === 'folder-empty') return 22;
      if (row.type === 'folder-header') return 32;
      return 34; // root-note and folder-note
    }, [rows]),
    overscan: 10,
  });

  return (
    <>
      {/* Header */}
      <div className="p-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex justify-between items-center">
        <span>{activeTagFilter ?? t('notes')}</span>
        <div className="flex items-center gap-1">
          <button onClick={cycleSortBy} className="flex items-center gap-0.5 hover:text-gray-800 dark:hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 animate-spring-scale" title={`${t('sortBy')} ${SORT_LABELS[sortBy]}`}>
            <ArrowUpDown size={11} /><span className="text-[10px]">{SORT_LABELS[sortBy]}</span>
          </button>
          {allTags.length > 0 && (
            <button onClick={() => setShowTags(v => !v)} className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 animate-spring-scale ${showTags ? 'text-[var(--accent)]' : 'hover:text-gray-800 dark:hover:text-gray-200'}`} title={t('tags')}>
              <Tag size={13} />
            </button>
          )}
          <button onClick={() => setNewFolderMode(true)} className="hover:text-gray-800 dark:hover:text-gray-200 p-1 animate-spring-scale" title={t('newFolder')}>
            <FolderPlus size={13} />
          </button>
          <button onClick={onOpenDaily} className="hover:text-gray-800 dark:hover:text-gray-200 p-1 animate-spring-scale" title={t('dailyNote')}>
            <CalendarDays size={14} />
          </button>
          <button onClick={() => onCreateNote()} className="hover:text-gray-800 dark:hover:text-gray-200 p-1 animate-spring-scale" aria-label={t('newNote')}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Tag filter */}
      {showTags && allTags.length > 0 && (
        <div className="px-2 pb-2 flex flex-wrap gap-1">
          {activeTagFilter && (
            <button onClick={() => onTagFilter?.(null)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)]">
              <X size={9} /> {t('all')}
            </button>
          )}
          {allTags.slice(0, 20).map(tag => (
            <button key={tag} onClick={() => onTagFilter?.(activeTagFilter === tag ? null : tag)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${activeTagFilter === tag ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)] border-[color-mix(in_srgb,var(--accent)_40%,transparent)]' : 'text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}>
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-2 pb-2">
        <div className="flex items-center gap-1.5 bg-gray-200/40 dark:bg-gray-800/40 rounded-lg px-2.5 py-1.5 group focus-within:bg-white dark:focus-within:bg-gray-800 focus-within:ring-1 focus-within:ring-[var(--accent)]/35 focus-within:shadow-sm transition-all duration-200">
          <Search size={12} className="text-gray-400 group-focus-within:text-[var(--accent)] shrink-0 transition-colors duration-200" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')}
            className="bg-transparent text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none w-full" />
          <kbd className="text-[9px] font-sans font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-900 group-focus-within:bg-white dark:group-focus-within:bg-gray-800 px-1 py-0.5 rounded shadow-sm border border-gray-200 dark:border-gray-700 shrink-0 select-none pointer-events-none transition-colors duration-200">
            ⌘P
          </kbd>
        </div>
      </div>

      {/* New folder input */}
      {newFolderMode && (
        <div className="px-2 pb-2">
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onBlur={() => void commitNewFolder()}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.repeat) return;
              if (e.key === 'Enter') void commitNewFolder();
              if (e.key === 'Escape') { setNewFolderMode(false); setNewFolderName(''); }
            }}
            placeholder={t('folderNamePlaceholder')}
            className="w-full bg-white dark:bg-gray-700 border border-[var(--accent)] rounded px-2 py-1 text-xs outline-none"
          />
        </div>
      )}

      {/* Note list */}
      <div
        ref={parentRef}
        onDragOver={e => {
          e.preventDefault();
          if (dragOver === null || dragOver === 'root') {
            setDragOver('root');
          }
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => void handleDrop(e, '')}
        className={`flex-1 px-2 overflow-y-auto scroll-fade-bottom transition-colors ${
          dragOver === 'root' ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] ring-1 ring-[var(--accent)]/30' : ''
        }`}
      >
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-4 px-2">
            {activeTagFilter ? t('noNotesWithTag').replace('{tag}', activeTagFilter) : query ? t('noNotesFound') : t('noNotesYet')}
          </p>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const row = rows[virtualItem.index];
              if (!row) return null;

              return (
                <div
                  key={
                    virtualItem.key !== undefined
                      ? virtualItem.key
                      : row.type === 'root-note'
                      ? `root-note-${row.note.name}`
                      : row.type === 'folder-header'
                      ? `folder-header-${row.folder.name}`
                      : row.type === 'folder-note'
                      ? `folder-note-${row.note.name}`
                      : `folder-empty-${row.folderName}`
                  }
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {row.type === 'root-note' && renderNote(row.note)}

                  {row.type === 'folder-header' && (
                    <div
                      className={`mb-1 rounded transition-colors ${
                        row.isDragTarget ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-1 ring-[var(--accent)]' : ''
                      }`}
                      style={{
                        boxShadow: dragOverFolderHeader === row.folder.name
                          ? (dragOverFolderPosition === 'before' ? 'inset 0 2px 0 var(--accent)' : 'inset 0 -2px 0 var(--accent)')
                          : undefined,
                      }}
                      onDragOver={e => handleFolderDragOver(e, row.folder.name)}
                      onDragLeave={() => {
                        setDragOver(null);
                        setDragOverFolderHeader(null);
                        setDragOverFolderPosition(null);
                      }}
                      onDrop={e => void handleFolderDrop(e, row.folder.name)}
                    >
                      {/* Folder header */}
                      <div
                        draggable={true}
                        onDragStart={e => {
                          e.dataTransfer?.setData('text/folder-name', row.folder.name);
                        }}
                        className="flex items-center gap-1 px-1 py-1.5 rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/50 group cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleFolder(row.folder.name)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.repeat) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleFolder(row.folder.name);
                          }
                        }}
                      >
                        <span className="text-gray-400">
                          {row.isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </span>
                        {row.isCollapsed ? (
                          <Folder size={13} className="text-gray-400" />
                        ) : (
                          <FolderOpen size={13} className="text-[var(--accent)]" />
                        )}

                        {renamingFolder === row.folder.name ? (
                          <input
                            // eslint-disable-next-line jsx-a11y/no-autofocus
                            autoFocus
                            value={folderRenameValue}
                            onChange={e => setFolderRenameValue(e.target.value)}
                            onBlur={() => void commitFolderRename()}
                            onKeyDown={e => {
                              if (e.nativeEvent.isComposing || e.repeat) return;
                              e.stopPropagation();
                              if (e.key === 'Enter') void commitFolderRename();
                              if (e.key === 'Escape') setRenamingFolder(null);
                            }}
                            onClick={e => e.stopPropagation()}
                            className="flex-1 bg-white dark:bg-gray-700 border border-[var(--accent)] rounded px-1 text-xs outline-none"
                          />
                        ) : (
                          <span
                            className="flex-1 text-xs font-medium text-gray-600 dark:text-gray-400 truncate"
                            onDoubleClick={e => {
                              e.stopPropagation();
                              setRenamingFolder(row.folder.name);
                              setFolderRenameValue(row.folder.name);
                            }}
                          >
                            {row.folder.name}
                          </span>
                        )}

                        <span className="text-[10px] text-gray-400">{row.folder.notes.length}</span>

                        {/* Folder actions */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                          <button
                            onMouseDown={e => e.stopPropagation()}
                            onClick={() => onCreateNote(row.folder.name)}
                            className="p-0.5 hover:text-[var(--accent)] text-gray-400"
                            title={t('newNoteHere')}
                          >
                            <Plus size={11} />
                          </button>
                          <button
                            onMouseDown={e => e.stopPropagation()}
                            onClick={async () => {
                              if (confirm(t('deleteFolderConfirm').replace('{name}', row.folder.name))) {
                                await onDeleteFolder(row.folder.name);
                              }
                            }}
                            className="p-0.5 hover:text-red-500 text-gray-400"
                            title={t('deleteFolder')}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {row.type === 'folder-note' && (
                    <div className="pl-4">
                      {renderNote(row.note, row.folderName)}
                    </div>
                  )}

                  {row.type === 'folder-empty' && (
                    <p
                      className="text-[10px] text-gray-400 px-2 py-1 italic pl-4"
                      onDragOver={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(row.folderName);
                      }}
                      onDragLeave={e => {
                        e.stopPropagation();
                        setDragOver(null);
                      }}
                      onDrop={e => {
                        e.stopPropagation();
                        void handleDrop(e, row.folderName);
                      }}
                    >
                      {t('emptyFolder')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings */}
      <div role="button" tabIndex={0} className="p-3 border-t border-gray-200/60 dark:border-gray-700/60 flex items-center justify-between text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer select-none bg-gray-50/20 dark:bg-gray-800/10"
        onClick={onOpenSettings}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.repeat) return;
          if (e.key === 'Enter' || e.key === ' ') onOpenSettings();
        }}>
        <span className="text-[10px] font-medium tracking-wide">
          {getNoteCounterText(notes.length, language)}
        </span>
        <span className="text-[10px] font-mono opacity-50">
          v{appVersion}
        </span>
        <button
          type="button"
          aria-label={t('settingsTitle') || 'Settings'}
          className="hover:rotate-45 transition-transform duration-300 ease-out focus:outline-none shrink-0"
          onClick={e => {
            e.stopPropagation();
            onOpenSettings();
          }}
        >
          <Settings size={14} />
        </button>
      </div>
    </>
  );
}
