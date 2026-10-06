import { useEffect, useId, useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { GitFileChange, GitFileDiff } from '../types';
import { Modal } from './Modal';
import { NoteDiffView } from './NoteDiffView';

/** One changed note, compared with its last commit, with the stage / unstage button next to it. */
export function NoteDiffDialog({
  file, syncDir, onStage, onUnstage, onClose,
}: {
  file: GitFileChange;
  syncDir?: string;
  onStage: (file: GitFileChange) => void;
  onUnstage: (file: GitFileChange) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [diff, setDiff] = useState<GitFileDiff | null>(null);
  // null: no error; '' : failed without a message of its own (shown translated)
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
    void window.electronAPI.gitFileDiff(file.path, syncDir)
      .then(res => {
        if (cancelled) return;
        if (res.success && res.data) setDiff(res.data);
        else setError(res.error ?? '');
      })
      .catch(() => { if (!cancelled) setError(''); });
    return () => { cancelled = true; };
    // `t` is a new function on every render: listing it would cancel and restart the request forever
  }, [file.path, syncDir]);

  const button = 'shrink-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800';
  return (
    <Modal id="git-diff" onClose={onClose} labelledBy={titleId} solid className="w-[760px] max-w-[94vw] max-h-[85vh]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/60">
        <h2 id={titleId} className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
          {t('gitDiffTitle').replace('{name}', file.path)}
        </h2>
        <div className="ml-auto flex gap-2">
          {file.unstaged && <button type="button" onClick={() => onStage(file)} className={button}>{t('gitStageFile')}</button>}
          {file.staged && <button type="button" onClick={() => onUnstage(file)} className={button}>{t('gitUnstageFile')}</button>}
        </div>
      </div>
      <div className="overflow-y-auto min-h-[6rem]">
        {error !== null && <p className="px-4 py-4 text-xs text-red-600 dark:text-red-400" role="alert">{error || t('gitDiffFailed')}</p>}
        {error === null && !diff && <p className="px-4 py-4 text-xs text-gray-500" role="status">{t('gitDiffLoading')}</p>}
        {diff && <NoteDiffView before={diff.before} after={diff.after} isNew={diff.isNew} isDeleted={diff.isDeleted} />}
      </div>
      <div className="flex justify-end px-4 py-3 border-t border-gray-100/40 dark:border-gray-700/40">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700/60">
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}
