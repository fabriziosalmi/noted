// Approval-gate policy: which human checkpoints a given approval mode enforces,
// and which direct transitions would illegally *bypass* a required checkpoint.
//
// Design (documented, backward-compatible with the single `approvalMode`
// string in the shipped schema): each mode enforces a fixed set of gate kinds.
// `manual` is the superset. A gate is enforced by *routing through* its request
// state (e.g. workflow `awaiting_plan_approval`); the engine forbids a direct
// transition that would skip a request state the mode requires.

import type { ApprovalMode, GateKind, GovernedNodeType } from './types';

const MODE_GATES: Record<ApprovalMode, readonly GateKind[]> = {
  autonomous: [],
  plan: ['plan'],
  action: ['action'],
  review: ['review'],
  release: ['release'],
  manual: ['plan', 'action', 'review', 'release'],
};

export function requiredGates(mode: ApprovalMode): readonly GateKind[] {
  return MODE_GATES[mode] ?? [];
}

export function modeRequiresGate(mode: ApprovalMode, gate: GateKind): boolean {
  return requiredGates(mode).includes(gate);
}

// Direct (non-approval) transitions that skip a gate request state, and the
// gate kind(s) they skip. Any transition not listed skips nothing.
const BYPASS: Record<GovernedNodeType, Record<string, GateKind[]>> = {
  workflow: {
    'draft->ready': ['plan'],
    'running->awaiting_output_approval': ['review'],
    'running->done': ['review', 'release'],
    // Recovering from `blocked` straight into work skips the plan gate; the
    // clean restart path is blocked -> draft -> awaiting_plan_approval.
    'blocked->ready': ['plan'],
    'blocked->running': ['plan'],
    'failed->ready': ['plan'],
  },
  task: {
    'running->verified': ['review'],
  },
  run: {},
};

/** Gate kinds a direct `from -> to` transition would skip for this node type. */
export function bypassedGates(type: GovernedNodeType, from: string, to: string): GateKind[] {
  return BYPASS[type][`${from}->${to}`] ?? [];
}

/**
 * The first gate a direct transition would illegally bypass under `mode`, or
 * null when the transition is allowed. Callers turn a non-null result into a
 * "request <gate> approval first" error.
 */
export function violatedGate(
  type: GovernedNodeType,
  mode: ApprovalMode,
  from: string,
  to: string,
): GateKind | null {
  for (const gate of bypassedGates(type, from, to)) {
    if (modeRequiresGate(mode, gate)) return gate;
  }
  return null;
}
