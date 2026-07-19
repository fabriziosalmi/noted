// Dependency gating for tasks: a task may only enter an active state once every
// task it `dependsOn` has completed. Pure over a task list — no I/O.

import type { AgentTaskNode, TaskStatus } from './types';

// A dependency counts as satisfied once its work is accepted.
const SATISFIED_DEP_STATUSES: ReadonlySet<TaskStatus> = new Set(['verified', 'done']);

// Task states that require dependencies to be satisfied before entering.
const DEP_GATED_TARGETS: ReadonlySet<TaskStatus> = new Set(['ready', 'claimed', 'running']);

export function isDependencyGatedTarget(status: string): boolean {
  return DEP_GATED_TARGETS.has(status as TaskStatus);
}

/**
 * Dependency ids that are not yet satisfied for `task`, given the full task set.
 * An id with no matching task counts as unmet (a dangling dependency blocks).
 */
export function unmetDependencies(
  task: Pick<AgentTaskNode, 'dependsOn'>,
  tasksById: Map<string, Pick<AgentTaskNode, 'status'>>,
): string[] {
  const deps = task.dependsOn ?? [];
  return deps.filter((depId) => {
    const dep = tasksById.get(depId);
    return !dep || !SATISFIED_DEP_STATUSES.has(dep.status as TaskStatus);
  });
}

export function dependenciesSatisfied(
  task: Pick<AgentTaskNode, 'dependsOn'>,
  tasksById: Map<string, Pick<AgentTaskNode, 'status'>>,
): boolean {
  return unmetDependencies(task, tasksById).length === 0;
}

/** Index a task array by id for the lookups above. */
export function indexTasks(tasks: AgentTaskNode[]): Map<string, AgentTaskNode> {
  return new Map(tasks.map((t) => [t.id, t]));
}
