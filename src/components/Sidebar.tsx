import { useRef, useState, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText, Plus, Trash2, Settings, Search, ArrowUpDown, Star } from 'lucide-react';
import type { NoteFile } from '../store/useStore';

type SortBy = 'date' | 'name' | 'size';
const SORT_LABELS: Record<SortBy, string> = { date: 'Data', name: 'Nome', size: 'Dim.' };

interface SidebarProps {
  notes: NoteFile[];
  activeNoteName: string | null;
  pinnedNotes: string[];
  onSelectNote: (name: string) => void;
  onCreateNote: () => void;
  onDeleteNote: (name: string) => void;
  onRenameNote: (oldName: string, newName: string) => Promise<void>;
  onTogglePin: (name: string) => void;
  onOpenSettings: () => void;
}

const ROW_HEIGHT = 36;

export function Sidebar({ notes, activeNoteName, pinnedNotes, onSelectNote, onCreateNote, onDeleteNote, onRenameNote, onTogglePin, onOpenSettings }: SidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [renamingNote, setRenamingNote] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const cycleSortBy = useCallback(() => {
    setSortBy(prev => prev === 'date' ? 'name' : prev === 'name' ? 'size' : 'date');
  }, []);

  const filtered = useMemo(() => {
    const base = query.trim()
      ? notes.filter(n => n.name.replace('.md', '').toLowerCase().includes(query.toLowerCase()))
      : [...notes];
    return base.sort((a, b) => {
      const aPinned = pinnedNotes.includes(a.name) ? 0 : 1;
      const bPinned = pinnedNotes.includes(b.name) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.stats.size - a.stats.size;
      return b.stats.mtimeMs - a.stats.mtimeMs;
    });
  }, [notes, query, sortBy, pinnedNotes]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const startRename = useCallback((note: NoteFile, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingNote(note.name);
    setRenameValue(note.name.replace('.md', ''));
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingNote || !renameValue.trim()) { setRenamingNote(null); return; }
    const newName = renameValue.trim();
    if (newName === renamingNote.replace('.md', '')) { setRenamingNote(null); return; }
    try {
      await onRenameNote(renamingNote, newName);
    } catch {
      // error handled upstream via toast
    } finally {
      setRenamingNote(null);
    }
  }, [renamingNote, renameValue, onRenameNote]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
    if (e.key === 'Escape') setRenamingNote(null);
  }, [commitRename]);

  return (
    <>
      {/* Header */}
      <div className="p-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex justify-between items-center">
        <span>Files</span>
        <div className="flex items-center gap-1">
          <button
            onClick={cycleSortBy}
            className="flex items-center gap-0.5 hover:text-gray-800 dark:hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title={`Ordina per: ${SORT_LABELS[sortBy]}`}
            aria-label={`Ordina per ${SORT_LABELS[sortBy]}`}
          >
            <ArrowUpDown size={11} />
            <span className="text-[10px]">{SORT_LABELS[sortBy]}</span>
          </button>
          <button onClick={onCreateNote} className="hover:text-gray-800 dark:hover:text-gray-200 p-1" aria-label="Nuova nota">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 pb-2">
        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 rounded px-2 py-1">
          <Search size={12} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cerca..."
            className="bg-transparent text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none w-full"
          />
        </div>
      </div>

      {/* Note list */}
      <div ref={scrollRef} className="flex-1 px-2 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualRow => {
            const note = filtered[virtualRow.index];
            const isActive = activeNoteName === note.name;
            const isRenaming = renamingNote === note.name;

            return (
              <div
                key={note.name}
                role="button"
                tabIndex={isRenaming ? -1 : 0}
                style={{ position: 'absolute', top: virtualRow.start, left: 0, right: 0 }}
                onClick={() => !isRenaming && onSelectNote(note.name)}
                onKeyDown={e => { if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectNote(note.name); } }}
                aria-label={note.name.replace('.md', '')}
                aria-current={isActive ? 'true' : undefined}
                className={`flex items-center justify-between p-2 rounded text-sm cursor-pointer mb-1 group ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                    : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2 truncate flex-1 min-w-0">
                  <FileText size={16} className="shrink-0" />
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={handleRenameKeyDown}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="truncate"
                      onDoubleClick={e => startRename(note, e)}
                      title="Doppio clic per rinominare"
                    >
                      {note.name.replace('.md', '')}
                    </span>
                  )}
                </div>
                {!isRenaming && (
                  <div className="flex items-center shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); onTogglePin(note.name); }}
                      className={`p-1 transition-colors ${pinnedNotes.includes(note.name) ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-400'}`}
                      aria-label={pinnedNotes.includes(note.name) ? `Rimuovi da preferiti` : `Aggiungi ai preferiti`}
                      title={pinnedNotes.includes(note.name) ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                    >
                      <Star size={12} fill={pinnedNotes.includes(note.name) ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onDeleteNote(note.name); }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1"
                      aria-label={`Elimina ${note.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && query && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-4">Nessuna nota trovata</p>
        )}
      </div>

      {/* Settings */}
      <div
        role="button"
        aria-label="Impostazioni"
        tabIndex={0}
        className="p-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        style={{ cursor: 'pointer' }}
        onClick={onOpenSettings}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpenSettings()}
      >
        <Settings size={18} />
      </div>
    </>
  );
}
