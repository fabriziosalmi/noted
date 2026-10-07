import { useMemo } from 'react';
import { Check, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { reviewable, type Reviewable } from '../../shared/diff/hunks';
import { DiffRowView } from './NoteDiffView';

/** Unchanged lines shown on each side of a change. */
const CONTEXT = 2;
const SKIPPED = 'bg-gray-100/60 dark:bg-gray-800/40 text-gray-400 dark:text-gray-500 select-none';
const toggle = 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 border first:rounded-l last:rounded-r';

/**
 * A proposed change to a text, as choices: each run of changed lines is a change that is kept or dropped on its own, with
 * the words that changed marked inside a rewritten line. Used for what a model proposes to a selection and for what an
 * agent proposes to a note. The parent owns the choice (`accepted`, the ids of the changes kept) and turns it into text with
 * `compose` from shared/diff/hunks.
 */
export function ReviewDiff({ before, after, accepted, onChange, model }: {
  before: string;
  after: string;
  accepted: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  /** The changes, when the caller knows them better than a comparison of the two texts would (each link its own change). */
  model?: Reviewable;
}) {
  const { t } = useI18n();
  const { pieces, changes } = useMemo(() => model ?? reviewable(before, after), [model, before, after]);
  const all = () => new Set(changes.map(c => c.id));
  const set = (id: number, keep: boolean) => { const next = new Set(accepted); if (keep) next.add(id); else next.delete(id); onChange(next); };

  if (changes.length === 0) {
    return <p className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400" role="status" data-testid="review-diff">{t('gitDiffNoChanges')}</p>;
  }

  return (
    <div data-testid="review-diff">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] border-b border-gray-200/60 dark:border-gray-700/60">
        <span role="status" data-testid="review-count">{t('reviewKept').replace('{n}', String(accepted.size)).replace('{total}', String(changes.length))}</span>
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => onChange(all())} disabled={accepted.size === changes.length} className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40">{t('reviewKeepAll')}</button>
          <button type="button" onClick={() => onChange(new Set())} disabled={accepted.size === 0} className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40">{t('reviewDropAll')}</button>
        </span>
      </div>
      <div className="font-mono text-[11px] leading-relaxed py-1">
        {pieces.map((piece, i) => {
          if (piece.kind === 'same') {
            const first = i === 0;
            const last = i === pieces.length - 1;
            const n = piece.rows.length;
            // Only the lines next to a change are shown: CONTEXT after the one before it, CONTEXT before the one after it.
            const head = first ? 0 : Math.min(CONTEXT, n);
            const tail = last ? 0 : Math.min(CONTEXT, n - head);
            const hidden = n - head - tail;
            return (
              <div key={`s${i}`}>
                {piece.rows.slice(0, head).map((row, j) => <DiffRowView key={`h${j}`} row={row} />)}
                {hidden > 0 && <div className={`px-3 py-0.5 ${SKIPPED}`}>{t('gitDiffSkipped').replace('{n}', String(hidden))}</div>}
                {piece.rows.slice(n - tail).map((row, j) => <DiffRowView key={`t${j}`} row={row} />)}
              </div>
            );
          }
          const change = changes[piece.id];
          const kept = accepted.has(piece.id);
          return (
            <section key={`c${piece.id}`} data-change={piece.id} data-kept={kept} aria-label={t('reviewChange').replace('{n}', String(piece.id + 1))} className="my-1 border-y border-gray-200/70 dark:border-gray-700/70">
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 dark:bg-gray-800/50 font-sans">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">{t('reviewChange').replace('{n}', String(piece.id + 1))}</span>
                <span className="ml-auto inline-flex" role="group" aria-label={t('reviewChange').replace('{n}', String(piece.id + 1))}>
                  <button type="button" aria-pressed={kept} onClick={() => set(piece.id, true)} className={`${toggle} ${kept ? 'bg-green-100 dark:bg-green-900/40 border-green-600/50 text-green-800 dark:text-green-300' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                    <Check size={11} aria-hidden="true" /> {t('reviewKeep')}
                  </button>
                  <button type="button" aria-pressed={!kept} onClick={() => set(piece.id, false)} className={`${toggle} ${!kept ? 'bg-gray-200 dark:bg-gray-700 border-gray-400/50 text-gray-800 dark:text-gray-200' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                    <X size={11} aria-hidden="true" /> {t('reviewDrop')}
                  </button>
                </span>
              </div>
              <div className={kept ? '' : 'opacity-45'}>
                {change.removed.map((row, j) => <DiffRowView key={`r${j}`} row={row} />)}
                {change.added.map((row, j) => <DiffRowView key={`a${j}`} row={row} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
