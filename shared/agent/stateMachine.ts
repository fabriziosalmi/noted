// Deterministic state machines for the three governed node lifecycles. A
// transition is legal only if it appears in the table below; gate states can be
// left only through approve/reject (see gates.ts + engine.ts), never a plain
// advance.

import type {
  GovernedNodeType,
  GateKind,
  WorkflowStatus,
  TaskStatus,
  RunStatus,
  AnyStatus,
} from './types';

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ['awaiting_plan_approval', 'ready', 'cancelled'],
  awaiting_plan_approval: ['ready', 'blocked', 'cancelled'],
  ready: ['running', 'blocked', 'cancelled'],
  running: ['awaiting_review', 'awaiting_output_approval', 'done', 'blocked', 'failed', 'cancelled'],
  awaiting_review: ['awaiting_output_approval', 'blocked', 'failed', 'cancelled'],
  awaiting_output_approval: ['done', 'blocked', 'cancelled'],
  done: [],
  blocked: ['draft', 'ready', 'running', 'cancelled'],
  failed: ['draft', 'ready', 'cancelled'],
  cancelled: [],
};

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['ready', 'blocked', 'stale'],
  ready: ['claimed', 'todo', 'blocked', 'stale'],
  claimed: ['running', 'todo', 'blocked', 'stale'],
  running: ['review', 'verified', 'blocked', 'failed'],
  review: ['verified', 'blocked', 'failed'],
  verified: ['done', 'blocked'],
  done: [],
  blocked: ['todo', 'ready', 'claimed', 'running'],
  failed: ['todo', 'ready', 'stale'],
  stale: ['todo', 'ready'],
};

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ['running', 'needs_approval', 'cancelled'],
  running: ['succeeded', 'failed', 'timed_out', 'cancelled'],
  needs_approval: ['running', 'cancelled'],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
};

const TABLES: Record<GovernedNodeType, Record<string, string[]>> = {
  workflow: WORKFLOW_TRANSITIONS,
  task: TASK_TRANSITIONS,
  run: RUN_TRANSITIONS,
};

/** A gate state: reachable request state whose exit needs approve/reject. */
interface GateSpec {
  kind: GateKind;
  approve: string;
  reject: string;
}

// The states that hold a pending human decision, keyed by node type + status.
const GATES: Record<GovernedNodeType, Partial<Record<string, GateSpec>>> = {
  workflow: {
    awaiting_plan_approval: { kind: 'plan', approve: 'ready', reject: 'blocked' },
    awaiting_review: { kind: 'review', approve: 'awaiting_output_approval', reject: 'blocked' },
    awaiting_output_approval: { kind: 'release', approve: 'done', reject: 'blocked' },
  },
  task: {
    review: { kind: 'review', approve: 'verified', reject: 'blocked' },
  },
  run: {
    needs_approval: { kind: 'action', approve: 'running', reject: 'cancelled' },
  },
};

export function statusesFor(type: GovernedNodeType): string[] {
  return Object.keys(TABLES[type]);
}

export function isKnownStatus(type: GovernedNodeType, status: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLES[type], status);
}

/** Legal next states from `from` (empty for terminal or unknown states). */
export function nextStatuses(type: GovernedNodeType, from: string): string[] {
  return TABLES[type][from] ?? [];
}

export function canTransition(type: GovernedNodeType, from: string, to: string): boolean {
  return nextStatuses(type, from).includes(to);
}

export function isTerminal(type: GovernedNodeType, status: string): boolean {
  return isKnownStatus(type, status) && nextStatuses(type, status).length === 0;
}

/** Gate spec if `status` is a pending-approval state, else null. */
export function gateStateOf(type: GovernedNodeType, status: string): (GateSpec & { status: string }) | null {
  const spec = GATES[type][status];
  return spec ? { ...spec, status } : null;
}

export function isGateStatus(type: GovernedNodeType, status: string): boolean {
  return gateStateOf(type, status) !== null;
}

/** All gate specs for a node type (used to reason about mode requirements). */
export function gateStatesOf(type: GovernedNodeType): (GateSpec & { status: string })[] {
  return Object.entries(GATES[type]).map(([status, spec]) => ({ ...(spec as GateSpec), status }));
}

export type { GateSpec, AnyStatus };
