import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import Fuse from 'fuse.js';
import { CalendarDays, FileText, Keyboard, LayoutTemplate, Search, Settings } from 'lucide-react';
import type { NoteFile } from '../store/useStore';
import { useI18n } from '../lib/i18n';
import { useModalStack } from '../hooks/useModalStack';

interface QuickOpenProps {
  notes: NoteFile[];
  onSelect: (name: string) => void;
  onCreateNote?: (name: string) => void;
  onOpenDaily?: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  onOpenTemplates?: () => void;
  onClose: () => void;
}

interface QuickAction {
  id: string;
  label: string;
  aliases: string[];
  run: () => void;
  icon: ReactNode;
}

export function QuickOpen({ notes, onSelect, onCreateNote, onOpenDaily, onOpenSettings, onOpenShortcuts, onOpenTemplates, onClose }: QuickOpenProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const notesKey = useMemo(() => {
    return notes.map(n => n.path).sort().join('\n');
  }, [notes]);

  const fuse = useMemo(() => new Fuse(notes, {
    keys: ['name'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [notesKey]);

  const results = useMemo(() => {
    if (query.startsWith('/')) return [];
    if (!query.trim()) {
      return [...notes]
        .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
        .slice(0, 20);
    }
    const searchResults = fuse.search(query);
    const notesMap = new Map(notes.map(n => [n.path, n]));
    return searchResults
      .map((r) => notesMap.get(r.item.path))
      .filter((n): n is NoteFile => !!n);
  }, [fuse, query, notes]);
  const normalizedQuery = query.trim().replace(/\.md$/i, '');
  const actions = useMemo<QuickAction[]>(() => ([
    {
      id: 'new-note',
      label: t('newNote'),
      aliases: ['new', 'note', 'create'],
      run: () => {
        onCreateNote?.(t('newNoteTitle'));
        onClose();
      },
      icon: <FileText size={14} className="opacity-70" />,
    },
    {
      id: 'daily-note',
      label: t('dailyNote'),
      aliases: ['daily', 'today', 'journal'],
      run: () => { onOpenDaily?.(); onClose(); },
      icon: <CalendarDays size={14} className="opacity-70" />,
    },
    {
      id: 'settings',
      label: t('settings'),
      aliases: ['settings', 'preferences', 'config'],
      run: () => { onOpenSettings?.(); onClose(); },
      icon: <Settings size={14} className="opacity-70" />,
    },
    {
      id: 'templates',
      label: t('templates'),
      aliases: ['templates', 'snippets'],
      run: () => { onOpenTemplates?.(); onClose(); },
      icon: <LayoutTemplate size={14} className="opacity-70" />,
    },
    {
      id: 'shortcuts',
      label: t('shortcuts'),
      aliases: ['shortcuts', 'keys', 'help'],
      run: () => { onOpenShortcuts?.(); onClose(); },
      icon: <Keyboard size={14} className="opacity-70" />,
    },
  ]), [onClose, onCreateNote, onOpenDaily, onOpenSettings, onOpenShortcuts, onOpenTemplates, t]);
  const actionQuery = query.startsWith('/') ? query.slice(1).trim().toLowerCase() : '';
  const actionResults = useMemo(() => {
    if (!query.startsWith('/')) return [];
    if (!actionQuery) return actions;
    return actions.filter((a) => {
      const hay = [a.label.toLowerCase(), ...a.aliases];
      return hay.some((x) => x.includes(actionQuery));
    });
  }, [actions, actionQuery, query]);
  const createCandidate = useMemo(() => {
    if (!onCreateNote || !normalizedQuery) return null;
    const candidate = `${normalizedQuery}.md`.toLowerCase();
    const exists = notes.some(n => n.name.toLowerCase() === candidate);
    return exists ? null : normalizedQuery;
  }, [notes, normalizedQuery, onCreateNote]);
  const totalRows = actionResults.length + results.length + (createCandidate ? 1 : 0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIdx(0); }, [query]);

  const confirm = useCallback((name: string) => {
    onSelect(name);
    onClose();
  }, [onSelect, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (totalRows <= 0) return;
        setActiveIdx(i => Math.min(i + 1, totalRows - 1));
      }
      if (e.key === 'ArrowUp')   {
        e.preventDefault();
        if (totalRows <= 0) return;
        setActiveIdx(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (actionResults[activeIdx]) {
          actionResults[activeIdx].run();
          return;
        }
        const noteIdx = activeIdx - actionResults.length;
        if (results[noteIdx]) {
          confirm(results[noteIdx].name);
          return;
        }
        if (createCandidate && activeIdx === actionResults.length + results.length && onCreateNote) {
          onCreateNote(createCandidate);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actionResults, results, activeIdx, confirm, createCandidate, onCreateNote, onClose, totalRows]);
  useModalStack('quick-open', true, onClose);

  // Keep active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-[3px] modal-backdrop-animate"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          onClose();
        }}
      />
      <div
        className="relative z-10 w-[560px] glass-modal rounded-xl overflow-hidden modal-content-animate"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-200/40 dark:border-gray-800/60">
          <Search size={16} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`${t('openNote')}  ·  / ${t('quickOpenCommands')}`}
            className="flex-1 bg-transparent outline-none text-gray-800 dark:text-gray-200 text-sm placeholder-gray-400 dark:placeholder-gray-500"
          />
          <kbd className="text-[10px] font-sans font-medium text-gray-400 dark:text-gray-500 bg-gray-100/40 dark:bg-gray-850/30 px-1.5 py-0.5 rounded border border-gray-200/40 dark:border-gray-700/40 shadow-sm select-none pointer-events-none">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto px-2 py-2 space-y-0.5">
          {actionResults.length === 0 && results.length === 0 && !createCandidate ? (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-8">{t('noNotesFound')}</p>
          ) : (
            <>
              {actionResults.map((action, i) => (
                <button
                  key={action.id}
                  data-idx={i}
                  onClick={action.run}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-all duration-150 group group/btn ${
                    i === activeIdx
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/40 dark:hover:bg-gray-850/30'
                  }`}
                >
                  <div className={`flex-shrink-0 transition-colors ${i === activeIdx ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                    {action.icon}
                  </div>
                  <span className="text-sm truncate font-medium">
                    <HighlightedText text={action.label} query={actionQuery} isActive={i === activeIdx} />
                  </span>
                </button>
              ))}
              
              {results.map((note, i) => {
                const idx = actionResults.length + i;
                const isSelected = idx === activeIdx;
                return (
                  <button
                    key={note.name}
                    data-idx={idx}
                    onClick={() => confirm(note.name)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-all duration-150 group group/btn ${
                      isSelected
                        ? 'bg-[var(--accent)] text-white shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/40 dark:hover:bg-gray-850/30'
                    }`}
                  >
                    <FileText size={14} className={`flex-shrink-0 transition-colors ${
                      isSelected ? 'text-white' : 'text-gray-400 dark:text-gray-500 opacity-70'
                    }`} />
                    <span className="text-sm truncate font-medium">
                      <HighlightedText text={note.name.replace('.md', '')} query={query} isActive={isSelected} />
                    </span>
                  </button>
                );
              })}

              {createCandidate && onCreateNote && (
                <>
                  <div className="border-t border-dashed border-gray-200/60 dark:border-gray-800/60 my-1 mx-1" />
                  <button
                    data-idx={actionResults.length + results.length}
                    onClick={() => { onCreateNote(createCandidate); onClose(); }}
                    onMouseEnter={() => setActiveIdx(actionResults.length + results.length)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-all duration-150 group group/btn ${
                      activeIdx === actionResults.length + results.length
                        ? 'bg-[var(--accent)] text-white shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/40 dark:hover:bg-gray-850/30'
                    }`}
                  >
                    <span className={`text-sm font-semibold ${activeIdx === actionResults.length + results.length ? 'text-white' : 'text-[var(--accent)]'}`}>+</span>
                    <span className="text-sm truncate">
                      {t('quickOpenCreate').replace('{name}', '')}
                      <strong className={activeIdx === actionResults.length + results.length ? 'text-white font-bold' : 'text-gray-900 dark:text-gray-100 font-bold'}>
                        {createCandidate}
                      </strong>
                    </span>
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {totalRows > 0 && (
          <div className="px-4 py-2 border-t border-gray-200/40 dark:border-gray-800/60 flex gap-4 text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-50/10 dark:bg-gray-900/10 shrink-0 select-none">
            <span>{t('navHint')}</span>
            <span>{t('openHint')}</span>
            <span>{t('escHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightedText({ text, query, isActive }: { text: string; query: string; isActive: boolean }) {
  if (!query.trim()) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi'));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={i}
            className={`rounded-[2px] px-0.5 font-semibold ${
              isActive
                ? 'bg-white/30 text-white'
                : 'bg-[var(--accent-light)] text-[var(--accent)]'
            }`}
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}
