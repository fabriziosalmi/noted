import { describe, it, expect } from 'vitest';
import {
  canTransition,
  nextStatuses,
  isTerminal,
  isGateStatus,
  gateStateOf,
  isKnownStatus,
} from './stateMachine';

describe('state machine transitions', () => {
  it('allows the happy-path workflow spine', () => {
    expect(canTransition('workflow', 'draft', 'awaiting_plan_approval')).toBe(true);
    expect(canTransition('workflow', 'awaiting_plan_approval', 'ready')).toBe(true);
    expect(canTransition('workflow', 'ready', 'running')).toBe(true);
    expect(canTransition('workflow', 'running', 'awaiting_review')).toBe(true);
    expect(canTransition('workflow', 'awaiting_output_approval', 'done')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('workflow', 'draft', 'done')).toBe(false);
    expect(canTransition('workflow', 'done', 'running')).toBe(false);
    expect(canTransition('task', 'todo', 'done')).toBe(false);
  });

  it('allows the happy-path task spine and recovery', () => {
    expect(canTransition('task', 'todo', 'ready')).toBe(true);
    expect(canTransition('task', 'ready', 'claimed')).toBe(true);
    expect(canTransition('task', 'claimed', 'running')).toBe(true);
    expect(canTransition('task', 'running', 'review')).toBe(true);
    expect(canTransition('task', 'review', 'verified')).toBe(true);
    expect(canTransition('task', 'verified', 'done')).toBe(true);
    expect(canTransition('task', 'blocked', 'ready')).toBe(true);
  });

  it('models run outcomes', () => {
    expect(canTransition('run', 'queued', 'running')).toBe(true);
    expect(canTransition('run', 'running', 'timed_out')).toBe(true);
    expect(canTransition('run', 'needs_approval', 'running')).toBe(true);
    expect(isTerminal('run', 'succeeded')).toBe(true);
  });

  it('flags terminal states', () => {
    expect(isTerminal('workflow', 'done')).toBe(true);
    expect(isTerminal('workflow', 'cancelled')).toBe(true);
    expect(isTerminal('workflow', 'running')).toBe(false);
    expect(nextStatuses('task', 'done')).toEqual([]);
  });

  it('identifies gate states and their approve/reject targets', () => {
    expect(isGateStatus('workflow', 'awaiting_plan_approval')).toBe(true);
    expect(isGateStatus('workflow', 'ready')).toBe(false);
    expect(gateStateOf('workflow', 'awaiting_output_approval')).toMatchObject({
      kind: 'release',
      approve: 'done',
      reject: 'blocked',
    });
    expect(gateStateOf('task', 'review')).toMatchObject({ kind: 'review', approve: 'verified' });
    expect(gateStateOf('run', 'needs_approval')).toMatchObject({ kind: 'action', approve: 'running', reject: 'cancelled' });
  });

  it('recognises unknown statuses', () => {
    expect(isKnownStatus('workflow', 'draft')).toBe(true);
    expect(isKnownStatus('workflow', 'bogus')).toBe(false);
    expect(nextStatuses('workflow', 'bogus')).toEqual([]);
  });
});
