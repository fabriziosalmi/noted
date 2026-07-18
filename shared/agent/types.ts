// Pure type surface for the agent-workflow runtime engine. No runtime imports —
// this module is bundled into both the Electron/MCP node builds and the Vite
// renderer, so it must stay dependency-free.

export type WorkflowStatus =
  | 'draft'
  | 'awaiting_plan_approval'
  | 'ready'
  | 'running'
  | 'awaiting_review'
  | 'awaiting_output_approval'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type TaskStatus =
  | 'todo'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'review'
  | 'verified'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'stale';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'needs_approval';

export type AnyStatus = WorkflowStatus | TaskStatus | RunStatus;

/** Node types that carry a governed lifecycle (workflow, task, run). */
export type GovernedNodeType = 'workflow' | 'task' | 'run';

/** All note types the MVP scaffolds (evidence notes have no state machine). */
export type AgentNoteType = 'workflow' | 'task' | 'runs' | 'reviews' | 'output';

export type ApprovalMode = 'autonomous' | 'plan' | 'action' | 'review' | 'release' | 'manual';

/** The four human-approval checkpoints a workflow can require. */
export type GateKind = 'plan' | 'action' | 'review' | 'release';

export const APPROVAL_MODES: readonly ApprovalMode[] = [
  'autonomous',
  'plan',
  'action',
  'review',
  'release',
  'manual',
];

/**
 * Parsed agent metadata block (the visible `## Agent Metadata` JSON in a note).
 * Mirrors the shape produced by the MCP `create_agent_workflow` scaffold; every
 * field beyond `notedAgent`/`type` is optional so partially-authored or
 * human-repaired notes still parse.
 */
export interface AgentMetadata {
  notedAgent: true;
  schemaVersion: number;
  type: AgentNoteType;
  id?: string;
  workflowId?: string;
  title?: string;
  status?: AnyStatus;
  approvalMode?: ApprovalMode;
  parentId?: string | null;
  dependsOn?: string[];
  owner?: string | null;
  createdAt?: string;
  updatedAt?: string;
  files?: { runs?: string; reviews?: string; output?: string };
  tasks?: AgentTaskNode[];
}

export interface AgentTaskNode {
  id: string;
  title: string;
  parentId: string | null;
  dependsOn: string[];
  file?: string;
  status: TaskStatus;
}

/** An append-only event describing a state change or evidence. */
export interface AgentEvent {
  type: string;
  actor: string;
  at: string;
  nodeId?: string;
  status?: AnyStatus;
  summary?: string;
  details?: Record<string, unknown>;
}

/** Map a note type to its governed lifecycle, or null for evidence notes. */
export function governedTypeOf(type: string): GovernedNodeType | null {
  if (type === 'workflow') return 'workflow';
  if (type === 'task') return 'task';
  return null;
}
