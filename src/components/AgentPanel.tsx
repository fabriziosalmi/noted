import { AlertTriangle, Bot, CheckCircle2, Check, Circle, Clock3, FileText, GitBranch, PlayCircle, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildAgentTaskTree, parseAgentNote, type AgentTaskNode, type AgentNodeStatus } from '../lib/agentWorkflow';
import { governedTypeOf, isGateStatus, nextStatuses } from '../../shared/agent';
import type { NoteFile, AgentUiAction } from '../store/useStore';
import { useI18n, type TranslationKey } from '../lib/i18n';

type TFn = (key: TranslationKey) => string;

interface AgentPanelProps {
  activeNoteName: string | null;
  activeNoteContent: string;
  notes: NoteFile[];
  onOpenNote: (name: string) => Promise<void>;
  onAgentAction?: (action: AgentUiAction) => Promise<void> | void;
}

function statusTone(status?: AgentNodeStatus) {
  switch (status) {
    case 'done':
    case 'verified':
    case 'succeeded':
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10';
    case 'running':
    case 'claimed':
    case 'review':
      return 'text-blue-600 dark:text-blue-400 bg-blue-500/10';
    case 'blocked':
    case 'failed':
    case 'stale':
    case 'timed_out':
      return 'text-red-600 dark:text-red-400 bg-red-500/10';
    case 'pending':
    case 'awaiting_plan_approval':
    case 'awaiting_output_approval':
      return 'text-amber-600 dark:text-amber-400 bg-amber-500/10';
    default:
      return 'text-gray-500 dark:text-gray-400 bg-gray-500/10';
  }
}

function statusIcon(status?: AgentNodeStatus) {
  if (status === 'done' || status === 'verified' || status === 'succeeded') {
    return <CheckCircle2 size={12} />;
  }
  if (status === 'running' || status === 'claimed') {
    return <PlayCircle size={12} />;
  }
  if (status === 'blocked' || status === 'failed' || status === 'stale' || status === 'timed_out') {
    return <AlertTriangle size={12} />;
  }
  if (status === 'pending' || status?.startsWith('awaiting')) {
    return <Clock3 size={12} />;
  }
  return <Circle size={12} />;
}

function StatusPill({ status, t }: { status?: AgentNodeStatus; t: TFn }) {
  const label = status ?? t('agentStatusUnknown');
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusTone(status)}`}>
      {statusIcon(status)}
      {label.replace(/_/g, ' ')}
    </span>
  );
}

function TaskTree({
  task,
  childrenByParent,
  existingNotes,
  onOpenNote,
  t,
  depth = 0,
}: {
  task: AgentTaskNode;
  childrenByParent: Map<string, AgentTaskNode[]>;
  existingNotes: Set<string>;
  onOpenNote: (name: string) => Promise<void>;
  t: TFn;
  depth?: number;
}) {
  const children = childrenByParent.get(task.id) ?? [];
  const canOpen = !!task.file && existingNotes.has(task.file);

  return (
    <div>
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => {
          if (task.file) void onOpenNote(task.file);
        }}
        className={`w-full text-left flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors ${
          canOpen ? 'hover:bg-gray-100/60 dark:hover:bg-gray-800/50' : 'cursor-default'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <span className="mt-0.5 text-gray-400 dark:text-gray-500">{statusIcon(task.status)}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
            {task.id} {task.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <StatusPill status={task.status} t={t} />
            {task.dependsOn.length > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                {t('agentDependsAfter')} {task.dependsOn.join(', ')}
              </span>
            )}
          </span>
        </span>
      </button>
      {children.map(child => (
        <TaskTree
          key={child.id}
          task={child}
          childrenByParent={childrenByParent}
          existingNotes={existingNotes}
          onOpenNote={onOpenNote}
          t={t}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function AgentPanel({ activeNoteName, activeNoteContent, notes, onOpenNote, onAgentAction }: AgentPanelProps) {
  const { t } = useI18n();
  const parsed = useMemo(() => parseAgentNote(activeNoteContent), [activeNoteContent]);
  const existingNotes = useMemo(() => new Set(notes.map(note => note.name)), [notes]);
  const taskTree = useMemo(
    () => buildAgentTaskTree(parsed.metadata?.tasks ?? []),
    [parsed.metadata?.tasks],
  );
  const [pending, setPending] = useState(false);

  const runAction = async (action: AgentUiAction) => {
    if (!onAgentAction || pending) return;
    setPending(true);
    try {
      await onAgentAction(action);
    } finally {
      setPending(false);
    }
  };

  if (!activeNoteName || !parsed.metadata) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <Bot size={30} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('agentEmpty')}</p>
        </div>
      </div>
    );
  }

  const meta = parsed.metadata;
  const linkedFiles = [
    meta.files?.runs,
    meta.files?.reviews,
    meta.files?.output,
  ].filter((file): file is string => !!file);

  const governed = governedTypeOf(meta.type);
  const status = meta.status ?? '';
  const atGate = governed ? isGateStatus(governed, status) : false;
  const nextStates = governed ? nextStatuses(governed, status) : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <section>
        <div className="flex items-start gap-2">
          <span className="p-1.5 rounded-md bg-[var(--accent-light)] text-[var(--accent)]">
            <GitBranch size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">
              {meta.id ?? meta.workflowId ?? activeNoteName.replace('.md', '')}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{meta.type}</p>
          </div>
          <StatusPill status={meta.status} t={t} />
        </div>
        {meta.approvalMode && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <ShieldCheck size={12} className="text-gray-400 dark:text-gray-500" />
            <span>{t('agentApproval')} {meta.approvalMode}</span>
          </div>
        )}
      </section>

      {onAgentAction && governed && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('agentActions')}</p>
          {atGate ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => void runAction({ kind: 'approve' })}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
              >
                <Check size={13} /> {t('agentApprove')}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void runAction({ kind: 'reject' })}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                <X size={13} /> {t('agentReject')}
              </button>
            </div>
          ) : nextStates.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {nextStates.map(next => (
                <button
                  key={next}
                  type="button"
                  disabled={pending}
                  onClick={() => void runAction({ kind: 'advance', to: next })}
                  className="px-2 py-1 rounded-md text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 transition-colors"
                >
                  {next.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('agentTerminal')}</p>
          )}
        </section>
      )}

      {meta.type === 'workflow' && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('agentWorkflowTree')}</p>
          {taskTree.roots.length > 0 ? (
            <div className="space-y-0.5">
              {taskTree.roots.map(task => (
                <TaskTree
                  key={task.id}
                  task={task}
                  childrenByParent={taskTree.children}
                  existingNotes={existingNotes}
                  onOpenNote={onOpenNote}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('agentNoTasks')}</p>
          )}
        </section>
      )}

      {meta.type !== 'workflow' && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('agentNode')}</p>
          <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
            {meta.workflowId && <p>{t('agentNodeWorkflow')} {meta.workflowId}</p>}
            {meta.parentId && <p>{t('agentNodeParent')} {meta.parentId}</p>}
            {meta.owner && <p>{t('agentNodeOwner')} {meta.owner}</p>}
            {meta.dependsOn && meta.dependsOn.length > 0 && <p>{t('agentNodeDependsOn')} {meta.dependsOn.join(', ')}</p>}
          </div>
        </section>
      )}

      {linkedFiles.length > 0 && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('agentLinkedNotes')}</p>
          <div className="space-y-1">
            {linkedFiles.map(file => (
              <button
                key={file}
                type="button"
                disabled={!existingNotes.has(file)}
                onClick={() => { void onOpenNote(file); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100/60 dark:hover:bg-gray-800/50 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <FileText size={12} className="text-gray-400 dark:text-gray-500" />
                <span className="truncate">{file}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('agentEvents')}</p>
        {parsed.events.length > 0 ? (
          <div className="space-y-2">
            {parsed.events.slice(-5).reverse().map((event, index) => (
              <div key={`${event.type}-${event.at}-${index}`} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3 py-0.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{event.type}</p>
                  {event.status && <StatusPill status={event.status} t={t} />}
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {event.actor} · {event.at.slice(0, 16).replace('T', ' ')}
                </p>
                {event.summary && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{event.summary}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('agentNoEvents')}</p>
        )}
      </section>
    </div>
  );
}

