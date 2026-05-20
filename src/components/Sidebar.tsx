import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  FileText, Plus, Trash2, Settings, Search, ArrowUpDown, Star, CalendarDays,
  Tag, X, FolderOpen, Folder, FolderPlus, ChevronRight, ChevronDown
} from 'lucide-react';
import type { NoteFile, FolderInfo } from '../store/useStore';
import { useI18n } from '../lib/i18n';

type SortBy = 'date' | 'name' | 'size';

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
      className={`flex items-center justify-between p-2 rounded text-sm cursor-pointer mb-0.5 group ${
        isActive
          ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
          : 'hover:bg-gray-200/70 dark:hover:bg-gray-700/60 text-gray-700 dark:text-gray-300'
      }`}
    >
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
            className={`p-1 transition-colors ${isPinned ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-400'}`}>
            <Star size={11} fill={isPinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1">
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
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [renamingNote, setRenamingNote] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const SORT_LABELS: Record<SortBy, string> = { date: t('sortDate'), name: t('sortName'), size: t('sortSize') };

  const [showTags, setShowTags] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null); // folder name or 'root'

  useEffect(() => {
    const clearDragState = () => setDragOver(null);
    window.addEventListener('dragend', clearDragState);
    window.addEventListener('drop', clearDragState);
    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('drop', clearDragState);
    };
  }, []);

  const cycleSortBy = useCallback(() => {
    setSortBy(prev => prev === 'date' ? 'name' : prev === 'name' ? 'size' : 'date');
  }, []);

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
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.stats.size - a.stats.size;
      return b.stats.mtimeMs - a.stats.mtimeMs;
    });
  }, [notes, query, sortBy, pinnedNotes]);

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

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, noteName: string) => {
    e.dataTransfer.setData('text/note-name', noteName);
  };

  const handleDrop = async (e: React.DragEvent, toFolder: string) => {
    e.preventDefault();
    setDragOver(null);
    const noteName = e.dataTransfer.getData('text/note-name');
    if (!noteName) return;
    const currentFolder = noteName.includes('/') ? noteName.split('/')[0] : '';
    if (currentFolder === toFolder) return;
    try { await onMoveNote(noteName, toFolder); } catch { /* toast */ }
  };

  const renderNote = (note: NoteFile) => (
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
  );

  return (
    <>
      {/* Header */}
      <div className="p-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex justify-between items-center">
        <span>{activeTagFilter ?? t('notes')}</span>
        <div className="flex items-center gap-1">
          <button onClick={cycleSortBy} className="flex items-center gap-0.5 hover:text-gray-800 dark:hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700" title={`${t('sortBy')} ${SORT_LABELS[sortBy]}`}>
            <ArrowUpDown size={11} /><span className="text-[10px]">{SORT_LABELS[sortBy]}</span>
          </button>
          {allTags.length > 0 && (
            <button onClick={() => setShowTags(v => !v)} className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${showTags ? 'text-[var(--accent)]' : 'hover:text-gray-800 dark:hover:text-gray-200'}`} title={t('tags')}>
              <Tag size={13} />
            </button>
          )}
          <button onClick={() => setNewFolderMode(true)} className="hover:text-gray-800 dark:hover:text-gray-200 p-1" title={t('newFolder')}>
            <FolderPlus size={13} />
          </button>
          <button onClick={onOpenDaily} className="hover:text-gray-800 dark:hover:text-gray-200 p-1" title={t('dailyNote')}>
            <CalendarDays size={14} />
          </button>
          <button onClick={() => onCreateNote()} className="hover:text-gray-800 dark:hover:text-gray-200 p-1" aria-label={t('newNote')}>
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
        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700/60 rounded px-2 py-1">
          <Search size={12} className="text-gray-400 shrink-0" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')}
            className="bg-transparent text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none w-full" />
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
      <div className="flex-1 px-2 overflow-y-auto">

        {/* Root notes drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver('root'); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={e => void handleDrop(e, '')}
          className={`min-h-[4px] rounded transition-colors ${dragOver === 'root' ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] ring-1 ring-[var(--accent)]' : ''}`}
        >
          {rootNotes.map(renderNote)}
        </div>

        {/* Folders */}
        {noteFolders
          .filter(f => !query || f.notes.some(n => n.name.toLowerCase().includes(query.toLowerCase())))
          .map(folder => {
            const isCollapsed = collapsedFolders.has(folder.name);
            const isDragTarget = dragOver === folder.name;
            const filteredFolderNotes = query
              ? folder.notes.filter(n => n.name.toLowerCase().includes(query.toLowerCase()))
              : folder.notes;

            return (
              <div key={folder.name} className={`mb-1 rounded transition-colors ${isDragTarget ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-1 ring-[var(--accent)]' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(folder.name); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => void handleDrop(e, folder.name)}>

                {/* Folder header */}
                <div
                  className="flex items-center gap-1 px-1 py-1.5 rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/50 group cursor-pointer select-none"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleFolder(folder.name)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.repeat) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleFolder(folder.name);
                    }
                  }}
                >
                  <span className="text-gray-400">{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
                  {isCollapsed ? <Folder size={13} className="text-gray-400" /> : <FolderOpen size={13} className="text-[var(--accent)]" />}

                  {renamingFolder === folder.name ? (
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
                    <span className="flex-1 text-xs font-medium text-gray-600 dark:text-gray-400 truncate"
                      onDoubleClick={e => { e.stopPropagation(); setRenamingFolder(folder.name); setFolderRenameValue(folder.name); }}>
                      {folder.name}
                    </span>
                  )}

                  <span className="text-[10px] text-gray-400">{folder.notes.length}</span>

                  {/* Folder actions */}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => onCreateNote(folder.name)}
                      className="p-0.5 hover:text-[var(--accent)] text-gray-400"
                      title={t('newNoteHere')}
                    >
                      <Plus size={11} />
                    </button>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={async () => { if (confirm(t('deleteFolderConfirm').replace('{name}', folder.name))) await onDeleteFolder(folder.name); }}
                      className="p-0.5 hover:text-red-500 text-gray-400"
                      title={t('deleteFolder')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {/* Folder notes */}
                {!isCollapsed && (
                  <div className="pl-4">
                    {filteredFolderNotes.map(renderNote)}
                    {filteredFolderNotes.length === 0 && !query && (
                      <p className="text-[10px] text-gray-400 px-2 py-1 italic">{t('emptyFolder')}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {rootNotes.length === 0 && noteFolders.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-4 px-2">
            {activeTagFilter ? t('noNotesWithTag').replace('{tag}', activeTagFilter) : query ? t('noNotesFound') : t('noNotesYet')}
          </p>
        )}
      </div>

      {/* Settings */}
      <div role="button" tabIndex={0} className="p-3 border-t border-gray-200/60 dark:border-gray-700/60 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
        onClick={onOpenSettings}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.repeat) return;
          if (e.key === 'Enter' || e.key === ' ') onOpenSettings();
        }}>
        <Settings size={18} />
      </div>
    </>
  );
}
