import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ShieldCheck, ShieldX } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { canUndo, clientsOf, filterEntries, groupSessions, type ActivityFilter } from '../lib/agentActivity';
import { NoteDiffView } from './NoteDiffView';
import type { JournalEntry } from '../../shared/vault/journalTypes';

const KIND_LABEL: Record<JournalEntry['kind'], TranslationKey> = { create: 'activityKindCreate', update: 'activityKindUpdate', delete: 'activityKindDelete' };
const control = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';
const small = 'shrink-0 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';

type Chain = { ok: true; entries: number } | { ok: false; at: number; reason: string };

/**
 * What assistants changed in the vault, newest first and by session: who, when, which note, and the difference. Any change can
 * be undone (or a whole session at once) as long as the note is still as the assistant left it. The journal is chained, and the
 * page says whether it still reads as it was written.
 */
export function AgentActivityPage({ onOpenNote, onNotice }: {
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t, language } = useI18n();
  const closeActivity = useStore(s => s.closeActivity);
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [reverted, setReverted] = useState<Set<string>>(new Set());
  const [chain, setChain] = useState<Chain | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>({});
  const [open, setOpen] = useState<Record<string, { before: string; after: string; kept: boolean } | 'loading'>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await getElectronApi()?.journalList?.(syncDir).catch(() => null);
    if (res?.success && res.data) {
      setEntries(res.data.entries);
      setTotal(res.data.total);
      setReverted(new Set(res.data.reverted));
      setChain(res.data.chain);
    }
  }, [syncDir]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const sessions = useMemo(() => groupSessions(shown), [shown]);
  const clients = useMemo(() => clientsOf(entries), [entries]);

  const toggleDiff = async (entry: JournalEntry) => {
    if (open[entry.id]) { setOpen(o => { const next = { ...o }; delete next[entry.id]; return next; }); return; }
    setOpen(o => ({ ...o, [entry.id]: 'loading' }));
    const res = await getElectronApi()?.journalDiff?.(entry.id, syncDir).catch(() => null);
    setOpen(o => ({ ...o, [entry.id]: res?.success && res.data ? res.data : { before: '', after: '', kept: false } }));
  };

  const undo = async (ids: string[]) => {
    const res = await getElectronApi()?.journalRevert?.(ids, syncDir).catch(() => null);
    if (res?.success && res.data) {
      const next: Record<string, string> = {};
      for (const r of res.data) next[r.id] = r.ok ? t('activityUndoDone') : t('activityUndoConflict').replace('{reason}', r.error ?? '');
      setMessages(m => ({ ...m, ...next }));
      if (res.data.some(r => r.ok)) void useStore.getState().fetchNotes();
    } else {
      onNotice?.(t('activityUndoConflict').replace('{reason}', res?.error ?? 'failed'), 'error');
    }
    await load();
  };

  const when = (iso: string) => new Date(iso).toLocaleString(language);

  return (
    <section aria-label={t('activityTitle')} className="flex-1 flex flex-col overflow-hidden" data-testid="activity-page">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button type="button" onClick={closeActivity} aria-label={t('viewClose')} title={t('viewClose')} className="p-1 rounded text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-semibold">{t('activityTitle')}</h1>
      </header>

      {chain && (chain.ok
        ? chain.entries > 0 && (
          <p data-testid="activity-chain" className="px-4 py-1.5 text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1.5">
            <ShieldCheck size={12} aria-hidden="true" /> {t('activityVerified').replace('{n}', String(chain.entries))}
          </p>
        )
        : (
          <p role="alert" data-testid="activity-chain" className="px-4 py-1.5 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 flex items-center gap-1.5">
            <ShieldX size={13} aria-hidden="true" /> {t('activityBroken').replace('{at}', String(chain.at)).replace('{reason}', chain.reason)}
          </p>
        ))}

      <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700">
        <select aria-label={t('activityClient')} value={filter.client ?? ''} onChange={e => setFilter(f => ({ ...f, client: e.target.value || undefined }))} className={control}>
          <option value="">{t('activityAllClients')}</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label={t('activityKind')} value={filter.kind ?? ''} onChange={e => setFilter(f => ({ ...f, kind: (e.target.value || undefined) as ActivityFilter['kind'] }))} className={control}>
          <option value="">{t('activityAllKinds')}</option>
          {(['create', 'update', 'delete'] as const).map(k => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
        </select>
        <input aria-label={t('activityNote')} type="search" value={filter.note ?? ''} onChange={e => setFilter(f => ({ ...f, note: e.target.value }))} placeholder={t('activityNote')} className={`${control} flex-1 min-w-[8rem]`} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {entries.length === 0 && <p className="py-8 text-sm text-gray-400" role="status">{t('activityEmpty')}</p>}
        {total > entries.length && <p className="pt-3 text-[11px] text-gray-400">{t('activityMore').replace('{n}', String(total - entries.length))}</p>}
        {sessions.map(session => {
          const undoable = session.entries.filter(e => canUndo(e, reverted));
          return (
            <section key={session.id} data-session={session.id} aria-label={session.client} className="mt-5">
              <header className="flex items-center gap-2 mb-1">
                <h2 className="text-sm font-semibold truncate">
                  {t('activitySession').replace('{client}', session.client).replace('{time}', when(session.startedAt)).replace('{n}', String(session.entries.length))}
                </h2>
                {undoable.length > 1 && (
                  <button type="button" onClick={() => { void undo(undoable.map(e => e.id)); }} className={`${small} ml-auto`}>{t('activityUndoSession')}</button>
                )}
              </header>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                {session.entries.map(entry => {
                  const diff = open[entry.id];
                  return (
                    <li key={entry.id} data-entry={entry.id} className="px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 w-16 shrink-0">{t(KIND_LABEL[entry.kind])}</span>
                        <button type="button" onClick={() => onOpenNote(entry.note)} className="text-[var(--accent)] hover:underline truncate">{entry.note.replace(/\.md$/i, '')}</button>
                        <span className="text-[11px] text-gray-400 truncate">{entry.tool} · {when(entry.at)}</span>
                        {entry.via === 'approval' && <span className="text-[10px] px-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{t('activityViaApproval')}</span>}
                        {entry.via === 'revert' && <span className="text-[10px] px-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{t('activityViaRevert')}</span>}
                        {reverted.has(entry.id) && <span className="text-[10px] px-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">{t('activityUndone')}</span>}
                        <span className="ml-auto flex gap-2">
                          <button type="button" onClick={() => { void toggleDiff(entry); }} aria-expanded={!!diff} className={small}>{diff ? t('activityHide') : t('activityShow')}</button>
                          {canUndo(entry, reverted) && <button type="button" onClick={() => { void undo([entry.id]); }} className={small}>{t('activityUndo')}</button>}
                        </span>
                      </div>
                      {messages[entry.id] && <p role="status" className="mt-1 text-[11px] text-gray-500">{messages[entry.id]}</p>}
                      {entry.noContent && <p className="mt-1 text-[11px] text-gray-400">{t('activityNoContent')}</p>}
                      {diff && diff !== 'loading' && diff.kept && (
                        <div className="mt-2 rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <NoteDiffView before={diff.before} after={diff.after} isNew={entry.kind === 'create'} isDeleted={entry.kind === 'delete'} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {entries.length > 0 && <p className="pt-4 text-[11px] text-gray-400">{shown.length === entries.length ? '' : t('activityShowing').replace('{shown}', String(shown.length)).replace('{total}', String(entries.length))}</p>}
      </div>
    </section>
  );
}
