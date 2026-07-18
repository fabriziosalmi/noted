import { useMemo } from 'react';
import { BookOpen, Clock, FileText, AlignLeft, Tag, MessageSquare } from 'lucide-react';
import { computeMetrics } from '../lib/textMetrics';
import { useI18n } from '../lib/i18n';

interface TextAnalyticsProps {
  getText: () => string;
  activeNoteName: string | null;
}

function ReadabilityBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 60 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-gray-200/40 dark:bg-gray-800/30 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 w-6 text-right">{pct}</span>
    </div>
  );
}

export function TextAnalytics({ getText, activeNoteName }: TextAnalyticsProps) {
  const { t } = useI18n();

  const metrics = useMemo(() => {
    if (!activeNoteName) return null;
    return computeMetrics(getText());
   
  }, [activeNoteName, getText]);

  if (!metrics || !activeNoteName) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('analyticsNoContent')}</p>
      </div>
    );
  }

  const statRow = (icon: React.ReactNode, label: string, value: string | number) => (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        {label}
      </div>
      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{value}</span>
    </div>
  );

  const toneColors: Record<string, string> = {
    formal: 'text-blue-500 dark:text-blue-400',
    neutral: 'text-gray-500 dark:text-gray-400',
    informal: 'text-amber-500 dark:text-amber-400',
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Counts */}
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('analyticsWords')}</p>
        <div className="divide-y divide-gray-100/40 dark:divide-gray-700/30">
          {statRow(<FileText size={11} />, t('analyticsWords'), metrics.words.toLocaleString())}
          {statRow(<AlignLeft size={11} />, t('analyticsChars'), metrics.chars.toLocaleString())}
          {statRow(<MessageSquare size={11} />, t('analyticsSentences'), metrics.sentences)}
          {statRow(<BookOpen size={11} />, t('analyticsParagraphs'), metrics.paragraphs)}
          {statRow(<Clock size={11} />, t('analyticsReadTime'), t('analyticsReadTimeMin').replace('{n}', String(metrics.readingTimeMin)))}
        </div>
      </section>

      {/* Readability */}
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('analyticsReadability')}</p>
        <div className="bg-gray-50/40 dark:bg-gray-850/30 border border-gray-100/40 dark:border-gray-700/40 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600 dark:text-gray-300">Flesch</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{metrics.fleschLabel}</span>
          </div>
          <ReadabilityBar score={metrics.fleschScore} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('analyticsToneLabel')}</span>
            <span className={`text-xs font-medium capitalize ${toneColors[metrics.tone]}`}>{metrics.tone}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Avg words/sentence</span>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{metrics.avgWordsPerSentence}</span>
          </div>
        </div>
      </section>

      {/* Keywords */}
      {metrics.topKeywords.length > 0 && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('analyticsKeywords')}</p>
          <div className="flex flex-wrap gap-1.5">
            {metrics.topKeywords.map(({ word, count }) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100/40 dark:bg-gray-850/30 border border-gray-200/40 dark:border-gray-700/40 text-gray-600 dark:text-gray-300"
                title={`${count}×`}
              >
                <Tag size={9} className="text-gray-400 dark:text-gray-500" />
                {word}
                <span className="text-[9px] text-gray-400 dark:text-gray-400">{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Metrics bar */}
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Distribution</p>
        <div className="space-y-1.5">
          {metrics.topKeywords.slice(0, 5).map(({ word, count }, idx) => {
            const max = metrics.topKeywords[0]?.count ?? 1;
            const pct = Math.round((count / max) * 100);
            return (
              <div key={word} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-3 text-right shrink-0">{idx + 1}</span>
                <div className="flex-1 h-1 bg-gray-200/40 dark:bg-gray-800/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                </div>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 truncate">{word}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
