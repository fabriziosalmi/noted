// The board of one workflow: its tasks by state, which task waits for which, and which decisions are waiting for a person.
// Pure over the workflow note's metadata (its `tasks[]` mirror): no I/O, bundled into the renderer.

import type { AgentMetadata, AgentTaskNode, GateKind, TaskStatus } from './types';
import { gateStateOf, isKnownStatus } from './stateMachine';
import { indexTasks } from './dependencies';

/** The order of the columns, from not started to finished, then what went wrong. */
export const BOARD_COLUMNS: readonly TaskStatus[] = ['todo', 'ready', 'claimed', 'running', 'review', 'verified', 'done', 'blocked', 'failed', 'stale'];

/** Columns shown even when empty: the path a task is expected to take. */
const ALWAYS: ReadonlySet<string> = new Set(['todo', 'running', 'review', 'done']);

/** The column for a task whose status is not one of the known ones (a note edited by hand). */
export const UNKNOWN_COLUMN = 'unknown';

export interface BoardDependency {
  id: string;
  /** The title when the task exists; null for a dependency on a task that is not in the workflow. */
  title: string | null;
  status: string | null;
  /** Done or verified: it no longer holds this task back. */
  met: boolean;
}

export interface BoardCard {
  id: string;
  title: string;
  status: string;
  file?: string;
  parentId: string | null;
  dependsOn: BoardDependency[];
  /** The ids of the tasks that wait for this one. */
  dependents: string[];
  /** Depends on something that is not finished yet (or that does not exist). */
  waiting: boolean;
  /** It is in a state that needs a person's decision (approve or reject). */
  atGate: GateKind | null;
}

export interface BoardColumn { status: string; cards: BoardCard[] }

export interface WorkflowBoard {
  columns: BoardColumn[];
  /** The decision the workflow itself is waiting for, if any. */
  workflowGate: { kind: GateKind; status: string } | null;
  total: number;
  /** Task ids that depend on each other in a loop; they can never start. */
  cyclic: string[];
}

const MET: ReadonlySet<string> = new Set(['verified', 'done']);

function cycleMembers(tasks: AgentTaskNode[]): string[] {
  const byId = indexTasks(tasks);
  const inCycle = new Set<string>();
  for (const start of tasks) {
    // A task is in a loop when following dependencies leads back to it.
    const seen = new Set<string>();
    const stack = [...(start.dependsOn ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === start.id) { inCycle.add(start.id); break; }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.dependsOn ?? []));
    }
  }
  return [...inCycle];
}

export function buildBoard(meta: Pick<AgentMetadata, 'tasks' | 'status'>): WorkflowBoard {
  const tasks = meta.tasks ?? [];
  const byId = indexTasks(tasks);
  const dependents = new Map<string, string[]>();
  for (const task of tasks) for (const dep of task.dependsOn ?? []) dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);

  const cards: BoardCard[] = tasks.map(task => {
    const dependsOn = (task.dependsOn ?? []).map((id): BoardDependency => {
      const dep = byId.get(id);
      return { id, title: dep?.title ?? null, status: dep?.status ?? null, met: !!dep && MET.has(dep.status) };
    });
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      ...(task.file ? { file: task.file } : {}),
      parentId: task.parentId ?? null,
      dependsOn,
      dependents: dependents.get(task.id) ?? [],
      waiting: dependsOn.some(d => !d.met),
      atGate: gateStateOf('task', task.status)?.kind ?? null,
    };
  });

  const columnOf = (card: BoardCard): string => (isKnownStatus('task', card.status) ? card.status : UNKNOWN_COLUMN);
  const columns: BoardColumn[] = [...BOARD_COLUMNS, UNKNOWN_COLUMN]
    .map(status => ({ status, cards: cards.filter(c => columnOf(c) === status) }))
    .filter(col => col.cards.length > 0 || ALWAYS.has(col.status));

  const wfGate = meta.status ? gateStateOf('workflow', meta.status) : null;
  return {
    columns,
    workflowGate: wfGate && meta.status ? { kind: wfGate.kind, status: meta.status } : null,
    total: cards.length,
    cyclic: cycleMembers(tasks),
  };
}
