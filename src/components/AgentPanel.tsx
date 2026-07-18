import { AlertTriangle, Bot, CheckCircle2, Circle, Clock3, FileText, GitBranch, PlayCircle, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { buildAgentTaskTree, parseAgentNote, type AgentTaskNode, type AgentNodeStatus } from '../lib/agentWorkflow';
import type { NoteFile } from '../store/useStore';

interface AgentPanelProps {
  activeNoteName: string | null;
  activeNoteContent: string;
  notes: NoteFile[];
  onOpenNote: (name: string) => Promise<void>;
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

function StatusPill({ status }: { status?: AgentNodeStatus }) {
  const label = status ?? 'unknown';
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
  depth = 0,
}: {
  task: AgentTaskNode;
  childrenByParent: Map<string, AgentTaskNode[]>;
  existingNotes: Set<string>;
  onOpenNote: (name: string) => Promise<void>;
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
            <StatusPill status={task.status} />
            {task.dependsOn.length > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                after {task.dependsOn.join(', ')}
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
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function AgentPanel({ activeNoteName, activeNoteContent, notes, onOpenNote }: AgentPanelProps) {
  const parsed = useMemo(() => parseAgentNote(activeNoteContent), [activeNoteContent]);
  const existingNotes = useMemo(() => new Set(notes.map(note => note.name)), [notes]);
  const taskTree = useMemo(
    () => buildAgentTaskTree(parsed.metadata?.tasks ?? []),
    [parsed.metadata?.tasks],
  );

  if (!activeNoteName || !parsed.metadata) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <Bot size={30} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-xs text-gray-500 dark:text-gray-400">Open an agent workflow note to inspect its tree.</p>
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
          <StatusPill status={meta.status} />
        </div>
        {meta.approvalMode && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <ShieldCheck size={12} className="text-gray-400 dark:text-gray-500" />
            <span>approval: {meta.approvalMode}</span>
          </div>
        )}
      </section>

      {meta.type === 'workflow' && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Workflow Tree</p>
          {taskTree.roots.length > 0 ? (
            <div className="space-y-0.5">
              {taskTree.roots.map(task => (
                <TaskTree
                  key={task.id}
                  task={task}
                  childrenByParent={taskTree.children}
                  existingNotes={existingNotes}
                  onOpenNote={onOpenNote}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">No tasks in this workflow metadata.</p>
          )}
        </section>
      )}

      {meta.type !== 'workflow' && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Node</p>
          <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
            {meta.workflowId && <p>workflow: {meta.workflowId}</p>}
            {meta.parentId && <p>parent: {meta.parentId}</p>}
            {meta.owner && <p>owner: {meta.owner}</p>}
            {meta.dependsOn && meta.dependsOn.length > 0 && <p>depends on: {meta.dependsOn.join(', ')}</p>}
          </div>
        </section>
      )}

      {linkedFiles.length > 0 && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Linked Notes</p>
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
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Events</p>
        {parsed.events.length > 0 ? (
          <div className="space-y-2">
            {parsed.events.slice(-5).reverse().map((event, index) => (
              <div key={`${event.type}-${event.at}-${index}`} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3 py-0.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{event.type}</p>
                  {event.status && <StatusPill status={event.status} />}
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
          <p className="text-xs text-gray-500 dark:text-gray-400">No structured events yet.</p>
        )}
      </section>
    </div>
  );
}

