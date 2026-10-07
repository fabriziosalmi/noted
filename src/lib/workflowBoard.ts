import {
  AgentEngineError,
  applyEngineResultToHtml,
  applyTaskStatusToWorkflow,
  approveGate,
  readAgentMetadata,
  rejectGate,
  writeAgentMetadata,
  type AgentMetadata,
  type EngineContext,
  type EngineResult,
  type TaskStatus,
} from '../../shared/agent';

/** The part of the app's API the board needs: reading and writing a note's text (as HTML). */
export interface NoteIo {
  read: (name: string) => Promise<string | null>;
  write: (name: string, html: string) => Promise<boolean>;
}

export interface LoadedWorkflow {
  /** The workflow note. */
  name: string;
  meta: AgentMetadata;
}

/** The workflow notes are named wf-<id>-<title>.md by the tool that makes them, in any folder. */
export const isWorkflowNoteName = (name: string): boolean => /(^|\/)wf-[^/]*\.md$/i.test(name);

/** Every workflow note among these note names, read and checked (a note named like one that is not one is left out). */
export async function loadWorkflows(names: string[], io: Pick<NoteIo, 'read'>): Promise<LoadedWorkflow[]> {
  const loaded = await Promise.all(names.filter(isWorkflowNoteName).map(async (name): Promise<LoadedWorkflow | null> => {
    const html = await io.read(name).catch(() => null);
    const meta = html ? readAgentMetadata(html) : null;
    return meta && meta.type === 'workflow' ? { name, meta } : null;
  }));
  return loaded.filter((w): w is LoadedWorkflow => w !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export type GateTarget =
  | { kind: 'workflow'; workflow: LoadedWorkflow }
  /** `seenStatus` is the state the person was looking at: the decision is refused if the task has moved since. */
  | { kind: 'task'; workflow: LoadedWorkflow; taskId: string; file: string; seenStatus: string };

export type GateDecision = { ok: true } | { ok: false; error: string; stale?: boolean };

const stale = (what: string): GateDecision => ({ ok: false, stale: true, error: `${what} changed since the board was loaded` });

/**
 * Approves or rejects the decision a workflow or one of its tasks is waiting for, with the same engine, the same rules and the
 * same notes as the Agent panel and the MCP tools: the state moves, an event is appended, and a task's new state is mirrored
 * into its workflow note. What was decided on is checked again against the notes as they are now, so a decision made on an out-of-date
 * board is refused instead of overwriting what an assistant did in the meantime.
 */
export async function decideGate(
  io: NoteIo,
  target: GateTarget,
  decision: 'approve' | 'reject',
  opts: { reason?: string; now?: string } = {},
): Promise<GateDecision> {
  const now = opts.now ?? new Date().toISOString();
  const run = (meta: AgentMetadata, ctx: EngineContext): EngineResult =>
    decision === 'approve' ? approveGate(meta, ctx) : rejectGate(meta, { ...ctx, reason: opts.reason });

  const wfHtml = await io.read(target.workflow.name).catch(() => null);
  const wfMeta = wfHtml ? readAgentMetadata(wfHtml) : null;
  if (!wfHtml || !wfMeta) return { ok: false, error: `${target.workflow.name} is not readable as a workflow` };

  try {
    if (target.kind === 'workflow') {
      if (wfMeta.status !== target.workflow.meta.status) return stale(target.workflow.name);
      const result = run(wfMeta, { actor: 'user', now, expectedUpdatedAt: target.workflow.meta.updatedAt });
      const html = applyEngineResultToHtml(wfHtml, result);
      if (!html) return { ok: false, error: 'the workflow has no agent metadata to update' };
      return (await io.write(target.workflow.name, html)) ? { ok: true } : { ok: false, error: `could not save ${target.workflow.name}` };
    }

    const taskHtml = await io.read(target.file).catch(() => null);
    const taskMeta = taskHtml ? readAgentMetadata(taskHtml) : null;
    if (!taskHtml || !taskMeta || taskMeta.type !== 'task' || taskMeta.id !== target.taskId) {
      return { ok: false, error: `${target.file} is not readable as task ${target.taskId}` };
    }
    if (taskMeta.status !== target.seenStatus) return stale(target.file);

    const result = run(taskMeta, { actor: 'user', now, mode: wfMeta.approvalMode, tasks: wfMeta.tasks });
    const html = applyEngineResultToHtml(taskHtml, result);
    if (!html) return { ok: false, error: 'the task has no agent metadata to update' };
    if (!(await io.write(target.file, html))) return { ok: false, error: `could not save ${target.file}` };

    const mirrored = applyTaskStatusToWorkflow(wfMeta, target.taskId, result.metadata.status as TaskStatus, now);
    if (mirrored !== wfMeta) {
      const next = writeAgentMetadata(wfHtml, mirrored);
      if (!next || !(await io.write(target.workflow.name, next))) {
        return { ok: false, error: `${target.taskId} was ${decision === 'approve' ? 'approved' : 'rejected'}, but ${target.workflow.name} could not be updated to match` };
      }
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof AgentEngineError) return { ok: false, error: e.message };
    throw e;
  }
}
