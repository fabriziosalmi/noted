import { useId, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { usePendingChanges } from '../hooks/usePendingChanges';
import { Modal } from './Modal';
import { useConfirm } from './ConfirmProvider';
import { NoteDiffView } from './NoteDiffView';
import { ReviewDiff } from './ReviewDiff';
import { compose, reviewable } from '../../shared/diff/hunks';
import { Tooltip } from './Tooltip';
import type { PendingChange } from '../../shared/vault/pending';

const KIND_LABEL = { create: 'pendingNew', update: 'pendingChanged', delete: 'pendingDelete' } as const;
const button = 'shrink-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800';

/**
 * The inbox of changes assistants proposed where their writes need approval: a badge with how many wait (nothing when none),
 * and a review that shows each as a difference with Approve and Reject. Approving makes the change in the note; rejecting
 * drops it. A change to a note that has changed since is refused, and says so.
 */
export function PendingChangesBadge({ onNotice }: { onNotice?: (message: string, variant?: 'success' | 'error') => void }) {
  const { t, language } = useI18n();
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const { changes, refresh } = usePendingChanges(syncDir);
  const [open, setOpen] = useState(false);
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  // For a change to an existing note: which of the agent's changes to it are kept (all, until the person chooses).
  const [kept, setKept] = useState<Record<string, Set<number>>>({});
  const titleId = useId();
  const models = useMemo(
    () => new Map(changes.filter(c => c.kind === 'update').map(c => [c.id, reviewable(c.before ?? '', c.after ?? '')])),
    [changes],
  );
  const confirm = useConfirm();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const keptOf = (change: PendingChange): Set<number> => kept[change.id] ?? new Set(models.get(change.id)?.changes.map(c => c.id));

  if (changes.length === 0 && !open) return null;

  /** Settles one change. `bulk`: no toast and no refresh of its own; the caller reports once and refreshes once. */
  const settle = async (change: PendingChange, approve: boolean, bulk = false): Promise<string | null> => {
    // Some of the agent's changes kept, some dropped: what is written is the note with only the kept ones made.
    const model = models.get(change.id);
    const choice = keptOf(change);
    const partial = approve && !!model && model.changes.length > 0 && choice.size < model.changes.length;
    const content = partial && model ? compose(change.before ?? '', change.after ?? '', model, choice) : undefined;
    const api = getElectronApi();
    const res = await (content === undefined ? api?.settlePendingChange?.(change.id, approve, syncDir) : api?.settlePendingChange?.(change.id, approve, syncDir, content))?.catch(() => null);
    let failure: string | null = null;
    if (res?.success) {
      setConflicts(c => { const next = new Set(c); next.delete(change.id); return next; });
    } else if (res?.conflict) {
      setConflicts(c => new Set(c).add(change.id));
    } else {
      failure = res?.error ?? 'failed';
      if (!bulk) onNotice?.(t('pendingFailed').replace('{error}', failure), 'error');
    }
    if (!bulk) {
      await refresh();
      // The note on screen may be the one that changed; the app's own change detection reloads it.
      void useStore.getState().fetchNotes();
    }
    return failure;
  };

  // Every change at once, after asking (approving can delete notes), with progress, and one report for the failures.
  const settleAll = async (approve: boolean) => {
    if (progress) return;
    const list = [...changes];
    const deletes = list.filter(c => c.kind === 'delete').length;
    const message = approve
      ? [t('pendingApproveAllConfirm').replace('{n}', String(list.length)), deletes ? t('pendingApproveAllDeletes').replace('{n}', String(deletes)) : ''].filter(Boolean).join(' ')
      : t('pendingRejectAllConfirm').replace('{n}', String(list.length));
    if (!(await confirm({ message, confirmLabel: t(approve ? 'pendingApproveAll' : 'pendingRejectAll'), danger: approve && deletes > 0 }))) return;
    const failures: string[] = [];
    setProgress({ done: 0, total: list.length });
    try {
      for (const [i, change] of list.entries()) {
        const failure = await settle(change, approve, true);
        if (failure) failures.push(failure);
        setProgress({ done: i + 1, total: list.length });
      }
    } finally {
      setProgress(null);
      await refresh();
      void useStore.getState().fetchNotes();
    }
    if (failures.length) {
      onNotice?.(t('pendingSomeFailed').replace('{n}', String(failures.length)).replace('{total}', String(list.length)).replace('{error}', failures[0]), 'error');
    }
  };

  return (
    <>
      {changes.length > 0 && (
        <Tooltip label={t('pendingTitle')} side="bottom">
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="pending-badge"
            aria-label={t('pendingBadge').replace('{n}', String(changes.length))}
            className="relative p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors"
          >
            <ShieldAlert size={16} />
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 bg-[var(--accent)] text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
              {changes.length > 9 ? '9+' : changes.length}
            </span>
          </button>
        </Tooltip>
      )}
      {open && (
        <Modal id="pending-changes" onClose={() => setOpen(false)} labelledBy={titleId} solid className="w-[820px] max-w-[94vw] max-h-[88vh]">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/60">
            <h2 id={titleId} className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('pendingTitle')}</h2>
            <div className="ml-auto flex gap-2">
              {progress && (
                <span role="status" className="self-center text-[11px] text-gray-500 dark:text-gray-400">
                  {t('pendingProgress').replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}
                </span>
              )}
              {changes.length > 1 && (
                <>
                  <button type="button" disabled={!!progress} onClick={() => { void settleAll(true); }} className={`${button} text-green-700 dark:text-green-400 disabled:opacity-40`}>{t('pendingApproveAll')}</button>
                  <button type="button" disabled={!!progress} onClick={() => { void settleAll(false); }} className={`${button} text-gray-600 dark:text-gray-300 disabled:opacity-40`}>{t('pendingRejectAll')}</button>
                </>
              )}
              <button type="button" onClick={() => setOpen(false)} className={`${button} text-gray-600 dark:text-gray-300`}>{t('pendingClose')}</button>
            </div>
          </div>
          <p className="px-4 py-2 text-[11px] text-gray-500 dark:text-gray-400">{t('pendingHelp')}</p>
          <div className="overflow-y-auto px-4 pb-4 space-y-4" data-testid="pending-list">
            {changes.length === 0 && <p className="py-6 text-sm text-gray-400" role="status">{t('pendingEmpty')}</p>}
            {changes.map(change => (
              <section key={change.id} data-pending={change.id} aria-label={change.note} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <header className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{t(KIND_LABEL[change.kind])}</span>
                  <span className="text-sm font-medium truncate">{change.note}</span>
                  <span className="text-[11px] text-gray-400 truncate">
                    {t('pendingBy').replace('{client}', change.client).replace('{time}', new Date(change.createdAt).toLocaleString(language))}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" disabled={conflicts.has(change.id) || (!!models.get(change.id)?.changes.length && keptOf(change).size === 0)} onClick={() => { void settle(change, true); }} className={`${button} text-green-700 dark:text-green-400 disabled:opacity-40`}>
                      {models.get(change.id) && keptOf(change).size < (models.get(change.id)?.changes.length ?? 0) && keptOf(change).size > 0
                        ? t('pendingApproveSome').replace('{n}', String(keptOf(change).size)).replace('{total}', String(models.get(change.id)?.changes.length))
                        : t('pendingApprove')}
                    </button>
                    <button type="button" onClick={() => { void settle(change, false); }} className={`${button} text-gray-600 dark:text-gray-300`}>{t('pendingReject')}</button>
                  </span>
                </header>
                {conflicts.has(change.id) && <p role="alert" className="px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30">{t('pendingConflict')}</p>}
                {change.kind === 'update'
                  ? <ReviewDiff before={change.before ?? ''} after={change.after ?? ''} accepted={keptOf(change)} onChange={next => setKept(k => ({ ...k, [change.id]: next }))} />
                  : <NoteDiffView before={change.before ?? ''} after={change.after ?? ''} isNew={change.kind === 'create'} isDeleted={change.kind === 'delete'} />}
              </section>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
