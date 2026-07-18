// The agent-workflow runtime engine: composes the state machine, gate policy,
// and dependency rules into three operations — advance, approveGate, rejectGate
// — each returning the next metadata plus the event to append. Pure: callers
// inject `now` and persist the results. `expectedUpdatedAt` gives optimistic
// concurrency so a stale approval (the note changed since it was read) is
// rejected instead of silently clobbering a concurrent edit.

import type { AgentMetadata, AgentEvent, ApprovalMode, GovernedNodeType, AnyStatus, TaskStatus } from './types';
import { governedTypeOf } from './types';
import { canTransition, isKnownStatus, isGateStatus, gateStateOf, isTerminal } from './stateMachine';
import { violatedGate } from './gates';
import { unmetDependencies, isDependencyGatedTarget, indexTasks } from './dependencies';

export type EngineErrorCode =
  | 'ungoverned'
  | 'unknown_status'
  | 'invalid_transition'
  | 'awaiting_approval'
  | 'not_gate_state'
  | 'gate_required'
  | 'dependencies_unmet'
  | 'stale'
  | 'terminal';

export class AgentEngineError extends Error {
  code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'AgentEngineError';
    this.code = code;
  }
}

export interface EngineContext {
  actor: string;
  now: string;
  /** Optimistic guard: reject when the note's updatedAt no longer matches. */
  expectedUpdatedAt?: string;
  summary?: string;
  /** Effective approval mode (from the workflow) — overrides meta.approvalMode. */
  mode?: ApprovalMode;
  /** Sibling task nodes, required to evaluate a task's dependencies. */
  tasks?: AgentMetadata['tasks'];
}

export interface EngineResult {
  metadata: AgentMetadata;
  event: AgentEvent;
}

const EVENT_TYPE: Record<GovernedNodeType, string> = {
  workflow: 'WorkflowStatusChanged',
  task: 'TaskStatusChanged',
  run: 'RunStatusChanged',
};

function governedType(meta: AgentMetadata): GovernedNodeType {
  const type = governedTypeOf(meta.type);
  if (!type) {
    throw new AgentEngineError('ungoverned', `note type "${meta.type}" has no governed lifecycle`);
  }
  return type;
}

export function effectiveMode(meta: AgentMetadata, ctx: EngineContext): ApprovalMode {
  return ctx.mode ?? meta.approvalMode ?? 'autonomous';
}

function checkFreshness(meta: AgentMetadata, ctx: EngineContext): void {
  if (ctx.expectedUpdatedAt !== undefined && meta.updatedAt !== ctx.expectedUpdatedAt) {
    throw new AgentEngineError(
      'stale',
      `note changed since it was read (expected updatedAt ${ctx.expectedUpdatedAt}, found ${meta.updatedAt ?? 'none'})`,
    );
  }
}

function makeEvent(
  type: GovernedNodeType,
  meta: AgentMetadata,
  status: AnyStatus,
  ctx: EngineContext,
  extra?: { eventType?: string; details?: Record<string, unknown> },
): AgentEvent {
  const event: AgentEvent = {
    type: extra?.eventType ?? EVENT_TYPE[type],
    actor: ctx.actor,
    at: ctx.now,
    status,
  };
  if (meta.id) event.nodeId = meta.id;
  if (ctx.summary) event.summary = ctx.summary;
  if (extra?.details) event.details = extra.details;
  return event;
}

/**
 * Move a node to `to`. Enforces the state machine, the approval-gate policy
 * (a direct transition may not skip a request state the mode requires), and —
 * for tasks — dependency completion. Gate states may only be left via
 * approve/reject (except an abort to `cancelled`).
 */
export function advance(meta: AgentMetadata, to: string, ctx: EngineContext): EngineResult {
  const type = governedType(meta);
  const from = meta.status ?? '';

  if (!isKnownStatus(type, from)) {
    throw new AgentEngineError('unknown_status', `unknown ${type} status "${from}"`);
  }
  if (isTerminal(type, from)) {
    throw new AgentEngineError('terminal', `${type} is in terminal state "${from}"`);
  }
  if (isGateStatus(type, from) && to !== 'cancelled') {
    throw new AgentEngineError(
      'awaiting_approval',
      `${type} is awaiting approval in "${from}" — use approve or reject`,
    );
  }
  if (!canTransition(type, from, to)) {
    throw new AgentEngineError('invalid_transition', `cannot move ${type} from "${from}" to "${to}"`);
  }

  checkFreshness(meta, ctx);

  const mode = effectiveMode(meta, ctx);
  const gate = violatedGate(type, mode, from, to);
  if (gate) {
    throw new AgentEngineError(
      'gate_required',
      `mode "${mode}" requires ${gate} approval before "${from}" -> "${to}"; request it via the gate state`,
    );
  }

  if (type === 'task' && isDependencyGatedTarget(to)) {
    const tasksById = indexTasks(ctx.tasks ?? []);
    const unmet = unmetDependencies({ dependsOn: meta.dependsOn ?? [] }, tasksById);
    if (unmet.length > 0) {
      throw new AgentEngineError(
        'dependencies_unmet',
        `task "${meta.id ?? '?'}" depends on unfinished tasks: ${unmet.join(', ')}`,
      );
    }
  }

  const metadata: AgentMetadata = { ...meta, status: to as AnyStatus, updatedAt: ctx.now };
  return { metadata, event: makeEvent(type, meta, to as AnyStatus, ctx) };
}

/** Approve the pending gate on a node, moving it to the gate's approve target. */
export function approveGate(meta: AgentMetadata, ctx: EngineContext): EngineResult {
  const type = governedType(meta);
  const from = meta.status ?? '';
  const gate = gateStateOf(type, from);
  if (!gate) {
    throw new AgentEngineError('not_gate_state', `${type} status "${from}" is not awaiting approval`);
  }
  checkFreshness(meta, ctx);

  const to = gate.approve as AnyStatus;
  const metadata: AgentMetadata = { ...meta, status: to, updatedAt: ctx.now };
  const event = makeEvent(type, meta, to, ctx, {
    eventType: 'GateApproved',
    details: { gate: gate.kind, from },
  });
  return { metadata, event };
}

/** Reject the pending gate on a node, moving it to the gate's reject target. */
export function rejectGate(meta: AgentMetadata, ctx: EngineContext & { reason?: string }): EngineResult {
  const type = governedType(meta);
  const from = meta.status ?? '';
  const gate = gateStateOf(type, from);
  if (!gate) {
    throw new AgentEngineError('not_gate_state', `${type} status "${from}" is not awaiting approval`);
  }
  checkFreshness(meta, ctx);

  const to = gate.reject as AnyStatus;
  const details: Record<string, unknown> = { gate: gate.kind, from };
  if (ctx.reason) details.reason = ctx.reason;
  const metadata: AgentMetadata = { ...meta, status: to, updatedAt: ctx.now };
  const event = makeEvent(type, meta, to, ctx, { eventType: 'GateRejected', details });
  return { metadata, event };
}

/**
 * Keep a workflow note's `tasks[]` mirror in sync with a task's new status.
 * Returns a new workflow metadata (updatedAt bumped) when the mirror changed,
 * or the same object untouched when the task id is absent / already in sync.
 */
export function applyTaskStatusToWorkflow(
  workflowMeta: AgentMetadata,
  taskId: string,
  status: TaskStatus,
  now: string,
): AgentMetadata {
  const tasks = workflowMeta.tasks ?? [];
  let changed = false;
  const nextTasks = tasks.map((t) => {
    if (t.id === taskId && t.status !== status) {
      changed = true;
      return { ...t, status };
    }
    return t;
  });
  if (!changed) return workflowMeta;
  return { ...workflowMeta, tasks: nextTasks, updatedAt: now };
}
