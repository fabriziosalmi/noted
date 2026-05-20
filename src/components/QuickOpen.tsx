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

  const fuse = useMemo(() => new Fuse(notes, {
    keys: ['name'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  }), [notes]);

  const results = useMemo(() => {
    if (query.startsWith('/')) return [];
    if (!query.trim()) {
      return [...notes]
        .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
        .slice(0, 20);
    }
    return fuse.search(query).map((r) => r.item);
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
        className="absolute inset-0"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          onClose();
        }}
      />
      <div
        className="relative z-10 w-[560px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/80 dark:border-gray-700/80 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`${t('openNote')}  ·  / ${t('quickOpenCommands')}`}
            className="flex-1 bg-transparent outline-none text-gray-800 dark:text-gray-200 text-sm placeholder-gray-400"
          />
          <kbd className="text-xs text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {actionResults.length === 0 && results.length === 0 && !createCandidate ? (
            <p className="text-center text-sm text-gray-400 py-8">{t('noNotesFound')}</p>
          ) : (
            <>
              {actionResults.map((action, i) => (
                <button
                  key={action.id}
                  data-idx={i}
                  onClick={action.run}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === activeIdx
                      ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  {action.icon}
                  <span className="text-sm truncate">{action.label}</span>
                </button>
              ))}
              {results.map((note, i) => (
                <button
                  key={note.name}
                  data-idx={actionResults.length + i}
                  onClick={() => confirm(note.name)}
                  onMouseEnter={() => setActiveIdx(actionResults.length + i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    actionResults.length + i === activeIdx
                      ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  <FileText size={14} className="flex-shrink-0 opacity-60" />
                  <span className="text-sm truncate">{note.name.replace('.md', '')}</span>
                </button>
              ))}
              {createCandidate && onCreateNote && (
                <button
                  data-idx={actionResults.length + results.length}
                  onClick={() => { onCreateNote(createCandidate); onClose(); }}
                  onMouseEnter={() => setActiveIdx(actionResults.length + results.length)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-t border-dashed border-gray-200 dark:border-gray-700 transition-colors ${
                    activeIdx === actionResults.length + results.length
                      ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  <span className="text-sm font-medium">+</span>
                  <span className="text-sm truncate">{t('quickOpenCreate').replace('{name}', createCandidate)}</span>
                </button>
              )}
            </>
          )}
        </div>

        {totalRows > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex gap-4 text-xs text-gray-400">
            <span>{t('navHint')}</span>
            <span>{t('openHint')}</span>
            <span>{t('escHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
