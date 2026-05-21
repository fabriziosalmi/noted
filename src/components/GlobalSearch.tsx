import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, FileText, Loader2, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useI18n } from '../lib/i18n';
import { useModalStack } from '../hooks/useModalStack';

interface SearchResult {
  relPath: string;
  title: string;
  snippet: string;
  score: number;
  terms: string[];
}

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        terms.some(t => t.toLowerCase() === part.toLowerCase())
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded-[2px] px-0.5 not-italic font-semibold">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

interface GlobalSearchProps {
  onSelect: (relPath: string) => void;
  onClose: () => void;
}

export function GlobalSearch({ onSelect, onClose }: GlobalSearchProps) {
  const { t } = useI18n();
  const syncDirectory = useStore(s => s.settings.syncDirectory);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef   = useRef<HTMLInputElement>(null);
  const listRef    = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic token to discard out-of-order responses (no AbortController on
  // the IPC bridge today — a stale response from a slow query must not
  // overwrite the result of a newer one).
  const queryIdRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIdx(0); }, [results]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myId = ++queryIdRef.current;
    debounceRef.current = setTimeout(async () => {
      const res = await window.electronAPI.searchNotesFulltext(query.trim(), syncDirectory ?? undefined);
      // Drop the result if a newer query has been fired in the meantime.
      if (myId !== queryIdRef.current) return;
      setResults((res?.data ?? []) as SearchResult[]);
      setLoading(false);
    }, 260);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, syncDirectory]);

  const confirm = useCallback((relPath: string) => {
    onSelect(relPath);
    onClose();
  }, [onSelect, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && results[activeIdx]) confirm(results[activeIdx].relPath);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [results, activeIdx, confirm]);
  useModalStack('global-search', true, onClose);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 modal-backdrop-animate"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          onClose();
        }}
      />
      <div
        className="relative z-10 w-[620px] bg-white/96 dark:bg-gray-900/96 backdrop-blur-xl border border-gray-200/80 dark:border-gray-700/80 rounded-xl shadow-2xl overflow-hidden modal-content-animate"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          {loading
            ? <Loader2 size={15} className="text-gray-400 shrink-0 animate-spin" />
            : <Search size={15} className="text-gray-400 shrink-0" />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search in all notes… (content, not just filenames)"
            className="flex-1 bg-transparent outline-none text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors">
              <X size={13} />
            </button>
          )}
          <kbd className="text-[11px] text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 ml-1">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {!query.trim() && (
            <div className="flex flex-col items-center gap-1.5 py-10 text-gray-400">
              <Search size={22} className="opacity-20" />
              <p className="text-xs">Full-text search · type at least 2 characters</p>
            </div>
          )}

          {query.trim().length >= 2 && !loading && results.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-10">{t('noNotesFound')}</p>
          )}

          {results.map((r, i) => (
            <button
              key={r.relPath}
              data-idx={i}
              onClick={() => confirm(r.relPath)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                i === activeIdx
                  ? 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              <FileText size={14} className="shrink-0 mt-0.5 text-gray-300 dark:text-gray-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className={`text-sm font-medium truncate ${i === activeIdx ? 'text-[var(--accent)]' : 'text-gray-800 dark:text-gray-200'}`}>
                    <HighlightedText text={r.title} terms={r.terms} />
                  </span>
                  {r.relPath.includes('/') && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 font-normal">
                      {r.relPath.split('/')[0]}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug line-clamp-2">
                  <HighlightedText text={r.snippet} terms={r.terms} />
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-[11px] text-gray-400">
          <span>{t('navHint')}</span>
          <span>{t('openHint')}</span>
          <span>{t('escHint')}</span>
          {results.length > 0 && (
            <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}
