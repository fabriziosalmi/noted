import { useId, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { compose, reviewable } from '../../shared/diff/hunks';
import { Modal } from './Modal';
import { ReviewDiff } from './ReviewDiff';

/**
 * What a model proposes for the text that was selected, to be read before anything changes: every change is kept or dropped on
 * its own, and what is applied is the text with the kept changes made. Nothing in the note is touched until Apply.
 */
export function AiEditReview({ title, original, proposed, onApply, onCancel }: {
  title: string;
  original: string;
  proposed: string;
  /** The text to put in place of the selection. */
  onApply: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const model = useMemo(() => reviewable(original, proposed), [original, proposed]);
  // Everything is kept to begin with: the usual answer is "yes, that", and a person who wants less drops what they do not want.
  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(model.changes.map(c => c.id)));

  return (
    <Modal id="ai-edit-review" onClose={onCancel} labelledBy={titleId} solid dismissOnBackdrop={false} className="w-[760px] max-w-[94vw] max-h-[86vh]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/60">
        <h2 id={titleId} className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('reviewAiTitle').replace('{action}', title)}</h2>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">{t('reviewDiscard')}</button>
          <button
            type="button"
            disabled={accepted.size === 0}
            onClick={() => onApply(compose(original, proposed, model, accepted))}
            className="text-xs px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40"
          >
            {t('reviewApply')}
          </button>
        </div>
      </div>
      <p className="px-4 py-2 text-[11px] text-gray-500 dark:text-gray-400">{t('reviewAiHelp')}</p>
      <div className="overflow-y-auto pb-3">
        <ReviewDiff before={original} after={proposed} accepted={accepted} onChange={setAccepted} />
      </div>
    </Modal>
  );
}
