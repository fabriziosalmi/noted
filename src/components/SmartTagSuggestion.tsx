import { useState, useEffect, useRef } from 'react';
import { Tag, X, Check, Loader2 } from 'lucide-react';
import { askLLM } from '../lib/llm';
import { useI18n } from '../lib/i18n';

interface SmartTagSuggestionProps {
  content: string;
  existingTags: string[];
  onAccept: (tags: string[]) => void;
}

export function SmartTagSuggestion({ content, existingTags, onAccept }: SmartTagSuggestionProps) {
  const { t } = useI18n();
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const prevContentRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dismissed) return;
    if (content === prevContentRef.current) return;
    // Only trigger after significant content change (> 200 chars difference)
    if (Math.abs(content.length - prevContentRef.current.length) < 200 && prevContentRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      prevContentRef.current = content;
      const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length < 100) return;

      setLoading(true);
      try {
        const result = await askLLM([
          {
            role: 'system',
            content: 'Sei un assistant che suggerisce tag per note. Restituisci SOLO una lista di 3-6 tag rilevanti separati da virgola, in lowercase, senza # e senza altra spiegazione. Esempio: lavoro, progetto, api, typescript',
          },
          {
            role: 'user',
            content: `Suggerisci tag per questa nota (evita questi già presenti: ${existingTags.join(', ')}):\n\n${text.slice(0, 1000)}`,
          },
        ]);
        const tags = result
          .split(',')
          .map(t => '#' + t.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_àèéìòù]/g, ''))
          .filter(t => t.length > 1 && !existingTags.includes(t))
          .slice(0, 6);
        if (tags.length > 0) {
          setSuggestedTags(tags);
          setSelected(new Set(tags)); // all selected by default
          setVisible(true);
        }
      } catch {
        // Silently fail — don't interrupt the writing flow
      } finally {
        setLoading(false);
      }
    }, 4000); // wait 4s after last significant change

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [content, existingTags, dismissed]);

  if (!visible && !loading) return null;

  if (loading) {
    return (
      <div className="fixed bottom-12 right-4 z-30 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 size={11} className="animate-spin" />
        <span>{t('analyzingTags')}</span>
      </div>
    );
  }

  if (!visible || suggestedTags.length === 0) return null;

  const handleAccept = () => {
    const accepted = suggestedTags.filter(t => selected.has(t));
    if (accepted.length > 0) onAccept(accepted);
    setVisible(false);
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-12 right-4 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/80 dark:border-gray-700/80 rounded-xl shadow-xl p-3 max-w-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
          <Tag size={11} />
          <span>{t('aiSuggestedTags')}</span>
        </div>
        <button onClick={() => { setVisible(false); setDismissed(true); }} className="text-gray-400 hover:text-gray-600" aria-label={t('dismissSuggestion')}>
          <X size={12} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {suggestedTags.map(tag => (
          <button
            key={tag}
            onClick={() => setSelected(prev => {
              const next = new Set(prev);
              next.has(tag) ? next.delete(tag) : next.add(tag);
              return next;
            })}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              selected.has(tag)
                ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] border-[color-mix(in_srgb,var(--accent)_40%,transparent)]'
                : 'text-gray-400 border-gray-200 dark:border-gray-700 line-through opacity-50'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleAccept}
          disabled={selected.size === 0}
          className="flex-1 flex items-center justify-center gap-1.5 bg-[var(--accent)] text-white text-xs py-1.5 rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Check size={11} />
          {t('insertInNote')}
        </button>
      </div>
    </div>
  );
}
