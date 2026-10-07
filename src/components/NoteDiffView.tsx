import { useMemo } from 'react';
import { useI18n } from '../lib/i18n';
import { diffStats, diffText, toHunks, type DiffRow } from '../../shared/diff/textDiff';

const ROW = {
  same: 'text-gray-600 dark:text-gray-300',
  del: 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200',
  add: 'bg-green-50 dark:bg-green-950/40 text-green-900 dark:text-green-200',
} as const;
const WORD = {
  del: 'bg-red-200 dark:bg-red-800/60 rounded-sm',
  add: 'bg-green-200 dark:bg-green-800/60 rounded-sm',
} as const;
const SIGN = { same: ' ', del: '−', add: '+' } as const;

/** One line of a diff, with its line numbers and the changed words marked. */
export function DiffRowView({ row }: { row: DiffRow }) {
  return (
    <div className={`flex ${ROW[row.kind]}`} data-kind={row.kind}>
      <span aria-hidden="true" className="w-9 shrink-0 text-right pr-1 select-none text-gray-400 dark:text-gray-500">{row.oldLine ?? ''}</span>
      <span aria-hidden="true" className="w-9 shrink-0 text-right pr-1 select-none text-gray-400 dark:text-gray-500">{row.newLine ?? ''}</span>
      <span aria-hidden="true" className="w-4 shrink-0 text-center select-none">{SIGN[row.kind]}</span>
      <span className="flex-1 whitespace-pre-wrap break-words min-w-0">
        {row.segments.length === 0 ? ' ' : row.segments.map((s, i) => (
          s.changed && row.kind !== 'same'
            ? <mark key={i} className={`${WORD[row.kind]} text-inherit`}>{s.text}</mark>
            : <span key={i}>{s.text}</span>
        ))}
      </span>
    </div>
  );
}

/**
 * The difference between two versions of a note, as Markdown text: the changed lines with two lines of context,
 * and inside a rewritten line the words that changed. Pure display; the texts are compared here.
 */
export function NoteDiffView({ before, after, isNew, isDeleted }: { before: string; after: string; isNew?: boolean; isDeleted?: boolean }) {
  const { t } = useI18n();
  const rows = useMemo(() => diffText(before, after), [before, after]);
  const { hunks, skippedAfter } = useMemo(() => toHunks(rows, 2), [rows]);
  const stats = useMemo(() => diffStats(rows), [rows]);

  return (
    <div data-testid="note-diff">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] border-b border-gray-200/60 dark:border-gray-700/60">
        {isNew && <span className="font-medium text-green-700 dark:text-green-400">{t('gitDiffNew')}</span>}
        {isDeleted && <span className="font-medium text-red-700 dark:text-red-400">{t('gitDiffDeleted')}</span>}
        <span
          className="ml-auto font-mono"
          aria-label={t('gitDiffStats').replace('{added}', String(stats.added)).replace('{removed}', String(stats.removed))}
        >
          <span className="text-green-700 dark:text-green-400">+{stats.added}</span>{' '}
          <span className="text-red-700 dark:text-red-400">−{stats.removed}</span>
        </span>
      </div>
      {hunks.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400" role="status">{t('gitDiffNoChanges')}</p>
      ) : (
        <div className="font-mono text-[11px] leading-relaxed py-1">
          {hunks.map((hunk, i) => (
            <div key={i}>
              {hunk.skipped > 0 && (
                <div className="px-3 py-0.5 text-gray-400 dark:text-gray-500 bg-gray-100/60 dark:bg-gray-800/40 select-none">
                  {t('gitDiffSkipped').replace('{n}', String(hunk.skipped))}
                </div>
              )}
              {hunk.rows.map((row, j) => <DiffRowView key={j} row={row} />)}
            </div>
          ))}
          {skippedAfter > 0 && (
            <div className="px-3 py-0.5 text-gray-400 dark:text-gray-500 bg-gray-100/60 dark:bg-gray-800/40 select-none">
              {t('gitDiffSkipped').replace('{n}', String(skippedAfter))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
