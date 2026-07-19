import { describe, it, expect } from 'vitest';
import { unmetDependencies, dependenciesSatisfied, isDependencyGatedTarget, indexTasks } from './dependencies';
import type { AgentTaskNode } from './types';

const task = (id: string, status: AgentTaskNode['status'], dependsOn: string[] = []): AgentTaskNode => ({
  id,
  title: id,
  parentId: null,
  dependsOn,
  status,
});

describe('task dependencies', () => {
  it('treats verified/done deps as satisfied', () => {
    const tasks = [task('T1', 'verified'), task('T2', 'done'), task('T3', 'todo', ['T1', 'T2'])];
    const byId = indexTasks(tasks);
    expect(dependenciesSatisfied(byId.get('T3')!, byId)).toBe(true);
    expect(unmetDependencies(byId.get('T3')!, byId)).toEqual([]);
  });

  it('reports incomplete and dangling deps as unmet', () => {
    const tasks = [task('T1', 'running'), task('T3', 'todo', ['T1', 'MISSING'])];
    const byId = indexTasks(tasks);
    expect(unmetDependencies(byId.get('T3')!, byId)).toEqual(['T1', 'MISSING']);
    expect(dependenciesSatisfied(byId.get('T3')!, byId)).toBe(false);
  });

  it('knows which target states are dependency-gated', () => {
    expect(isDependencyGatedTarget('ready')).toBe(true);
    expect(isDependencyGatedTarget('running')).toBe(true);
    expect(isDependencyGatedTarget('blocked')).toBe(false);
    expect(isDependencyGatedTarget('todo')).toBe(false);
  });
});
