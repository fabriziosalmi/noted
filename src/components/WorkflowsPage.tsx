import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Clock3, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { flushPendingSaves } from '../lib/pendingSave';
import { decideGate, isWorkflowNoteName, loadWorkflows, type GateTarget, type LoadedWorkflow, type NoteIo } from '../lib/workflowBoard';
import { buildBoard, type BoardCard, type GateKind } from '../../shared/agent';
import { usePrompt } from './ConfirmProvider';

const COLUMN_LABEL: Record<string, TranslationKey> = {
  todo: 'workflowsColTodo', ready: 'workflowsColReady', claimed: 'workflowsColClaimed', running: 'workflowsColRunning', review: 'workflowsColReview',
  verified: 'workflowsColVerified', done: 'workflowsColDone', blocked: 'workflowsColBlocked', failed: 'workflowsColFailed', stale: 'workflowsColStale', unknown: 'workflowsColUnknown',
};
const GATE_LABEL: Record<GateKind, TranslationKey> = { plan: 'workflowsGatePlan', action: 'workflowsGateAction', review: 'workflowsGateReview', release: 'workflowsGateRelease' };
const small = 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded border disabled:opacity-40';
const approveStyle = `${small} border-green-600/40 text-green-700 dark:text-green-400 hover:bg-green-500/10`;
const rejectStyle = `${small} border-red-600/40 text-red-700 dark:text-red-400 hover:bg-red-500/10`;

/**
 * An agent workflow as a board: its tasks by state, what each one waits for, and the decisions that wait for you, which you approve
 * or reject here. The notes stay the record: a decision is written into them as the Agent panel and the MCP tools write it.
 */
export function WorkflowsPage({ onOpenNote, onNotice }: {
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const closeWorkflows = useStore(s => s.closeWorkflows);
  const notes = useStore(s => s.notes);
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const prompt = usePrompt();
  const [workflows, setWorkflows] = useState<LoadedWorkflow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const io = useMemo<NoteIo>(() => ({
    read: async name => {
      const res = await getElectronApi()?.readNote(name, syncDir);
      return res?.success && typeof res.data === 'string' ? res.data : null;
    },
    write: async (name, html) => {
      const res = await getElectronApi()?.saveNote(name, html, syncDir);
      // The open note is in the editor: hand it the new text, so the editor's own save cannot put the old one back.
      if (res?.success && name === useStore.getState().activeNoteName) useStore.getState().notifyExternalChange(name);
      return res?.success === true;
    },
  }), [syncDir]);

  const names = useMemo(() => notes.map(n => n.name).filter(isWorkflowNoteName), [notes]);
  const reload = useCallback(async () => { setWorkflows(await loadWorkflows(names, io)); }, [names, io]);
  useEffect(() => { void reload(); }, [reload, notes]);

  const current = workflows?.find(w => w.name === selected) ?? workflows?.[0];
  const board = useMemo(() => (current ? buildBoard(current.meta) : null), [current]);

  const decide = async (target: GateTarget, decision: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (decision === 'reject') {
      const answer = await prompt({ title: t('workflowsReject'), message: t('workflowsRejectWhy'), defaultValue: t('workflowsRejectDefault') });
      if (answer === null) return;
      reason = answer;
    }
    setBusy(true);
    try {
      await flushPendingSaves().catch(() => undefined); // what is typed in the open note goes to disk first
      const res = await decideGate(io, target, decision, { reason });
      if (res.ok) {
        onNotice?.(t(decision === 'approve' ? 'workflowsApproved' : 'workflowsRejected'), 'success');
        void useStore.getState().fetchNotes();
      } else {
        onNotice?.(res.stale ? t('workflowsOutOfDate') : t('workflowsFailed').replace('{error}', res.error), 'error');
      }
      await reload(); // whatever happened, the board shows the notes as they are now
    } finally {
      setBusy(false);
    }
  };

  const decisions = (target: GateTarget, label: string) => (
    <span className="flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={() => { void decide(target, 'approve'); }} aria-label={`${t('workflowsApprove')}: ${label}`} className={approveStyle}>
        <Check size={12} aria-hidden="true" /> {t('workflowsApprove')}
      </button>
      <button type="button" disabled={busy} onClick={() => { void decide(target, 'reject'); }} aria-label={`${t('workflowsReject')}: ${label}`} className={rejectStyle}>
        <X size={12} aria-hidden="true" /> {t('workflowsReject')}
      </button>
    </span>
  );

  const card = (c: BoardCard) => (
    <article key={c.id} data-task={c.id} className={`rounded-md border p-2 text-xs bg-white dark:bg-gray-800 ${c.atGate ? 'border-amber-500/60' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 font-mono text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">{c.id}</span>
        {c.file
          ? <button type="button" onClick={() => onOpenNote(c.file as string)} title={t('workflowsOpenNote')} className="min-w-0 text-left font-medium text-gray-800 dark:text-gray-100 hover:text-[var(--accent)]">{c.title}</button>
          : <span className="min-w-0 font-medium text-gray-800 dark:text-gray-100">{c.title}</span>}
      </div>
      {c.dependsOn.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={t('workflowsDependsOn')}>
          {c.dependsOn.map(d => (
            <li key={d.id} data-dependency={d.id} data-met={d.met} title={d.title ?? t('workflowsMissing')}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${d.met ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
              {d.met ? <Check size={10} aria-hidden="true" /> : <Clock3 size={10} aria-hidden="true" />}
              <span className="sr-only">{t(d.met ? 'workflowsDepMet' : 'workflowsDepOpen')}</span>
              {t('workflowsAfter')} {d.id}{d.title === null && <CircleAlert size={10} aria-label={t('workflowsMissing')} />}
            </li>
          ))}
        </ul>
      )}
      {c.dependents.length > 0 && <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{t('workflowsBlocks')} {c.dependents.join(', ')}</p>}
      {c.atGate && c.file && current && (
        <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-gray-700/70 space-y-1.5">
          <p className="text-[10px] text-amber-700 dark:text-amber-400">{t('workflowsAwaiting')}</p>
          {decisions({ kind: 'task', workflow: current, taskId: c.id, file: c.file, seenStatus: c.status }, c.id)}
        </div>
      )}
    </article>
  );

  return (
    <section aria-label={t('workflowsTitle')} className="flex-1 flex flex-col overflow-hidden" data-testid="workflows-page">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button type="button" onClick={closeWorkflows} aria-label={t('viewClose')} title={t('viewClose')} className="p-1 rounded text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-semibold">{t('workflowsTitle')}</h1>
        {workflows && workflows.length > 1 && (
          <select aria-label={t('workflowsPick')} value={current?.name} onChange={e => setSelected(e.target.value)}
            className="ml-auto max-w-[50%] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]">
            {workflows.map(w => <option key={w.name} value={w.name}>{w.meta.id ?? w.name}{w.meta.title ? ` — ${w.meta.title}` : ''}</option>)}
          </select>
        )}
      </header>

      {workflows && workflows.length === 0 && <p className="p-6 text-sm text-gray-500 dark:text-gray-400" data-testid="workflows-empty">{t('workflowsEmpty')}</p>}

      {current && board && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200/60 dark:border-gray-700/60">
            <button type="button" onClick={() => onOpenNote(current.name)} className="font-medium text-gray-800 dark:text-gray-100 hover:text-[var(--accent)]">
              {current.meta.id ?? current.name}{current.meta.title ? ` — ${current.meta.title}` : ''}
            </button>
            <span data-testid="workflow-status" className="px-1.5 py-0.5 rounded bg-gray-500/10">{current.meta.status ?? t('agentStatusUnknown')}</span>
            {current.meta.approvalMode && <span>{t('agentApproval')} {current.meta.approvalMode}</span>}
            <span>{t('workflowsTaskCount').replace('{n}', String(board.total))}</span>
          </div>

          {board.workflowGate && (
            <div role="group" aria-label={t(GATE_LABEL[board.workflowGate.kind])} data-testid="workflow-gate" className="flex flex-wrap items-center gap-3 px-4 py-2 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300">
              <Clock3 size={13} aria-hidden="true" />
              <span className="font-medium">{t(GATE_LABEL[board.workflowGate.kind])}</span>
              {decisions({ kind: 'workflow', workflow: current }, current.meta.id ?? current.name)}
            </div>
          )}
          {board.cyclic.length > 0 && (
            <p role="alert" data-testid="workflow-cycle" className="px-4 py-1.5 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30">
              {t('workflowsCycle').replace('{ids}', board.cyclic.join(', '))}
            </p>
          )}

          <div className="flex-1 overflow-auto p-4">
            {board.total === 0
              ? <p className="text-sm text-gray-500 dark:text-gray-400">{t('workflowsNoTasks')}</p>
              : (
                <div className="flex gap-3 items-start min-w-min">
                  {board.columns.map(col => (
                    <div key={col.status} role="group" aria-label={t(COLUMN_LABEL[col.status] ?? 'workflowsColUnknown')} data-column={col.status} className="w-60 shrink-0 rounded-lg bg-gray-100/70 dark:bg-gray-800/50 p-2 space-y-2">
                      <h2 className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {t(COLUMN_LABEL[col.status] ?? 'workflowsColUnknown')}
                        <span className="font-normal tabular-nums">{col.cards.length}</span>
                      </h2>
                      {col.cards.map(card)}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </>
      )}
    </section>
  );
}
