import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Fuse from 'fuse.js';
import { FileText, Search } from 'lucide-react';
import type { NoteFile } from '../store/useStore';
import { useI18n } from '../lib/i18n';

interface QuickOpenProps {
  notes: NoteFile[];
  onSelect: (name: string) => void;
  onClose: () => void;
}

export function QuickOpen({ notes, onSelect, onClose }: QuickOpenProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fuse = useMemo(() => new Fuse(notes, {
    keys: ['name'],
    threshold: 0.4,
    ignoreLocation: true,
  }), [notes]);

  const results = useMemo(() =>
    query.trim() ? fuse.search(query).map(r => r.item) : notes.slice(0, 12),
    [fuse, query, notes],
  );

  useEffect(() => { inputRef.current?.focus(); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setActiveIdx(0); }, [query]);

  const confirm = useCallback((name: string) => {
    onSelect(name);
    onClose();
  }, [onSelect, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && results[activeIdx]) confirm(results[activeIdx].name);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [results, activeIdx, confirm, onClose]);

  // Keep active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="w-[560px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/80 dark:border-gray-700/80 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('openNote')}
            className="flex-1 bg-transparent outline-none text-gray-800 dark:text-gray-200 text-sm placeholder-gray-400"
          />
          <kbd className="text-xs text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">{t('noNotesFound')}</p>
          ) : results.map((note, i) => (
            <button
              key={note.name}
              data-idx={i}
              onClick={() => confirm(note.name)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === activeIdx
                  ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              <FileText size={14} className="flex-shrink-0 opacity-60" />
              <span className="text-sm truncate">{note.name.replace('.md', '')}</span>
            </button>
          ))}
        </div>

        {results.length > 0 && (
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
