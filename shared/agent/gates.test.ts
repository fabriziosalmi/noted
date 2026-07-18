import { describe, it, expect } from 'vitest';
import { requiredGates, modeRequiresGate, bypassedGates, violatedGate } from './gates';

describe('approval gate policy', () => {
  it('maps modes to their required gate kinds', () => {
    expect(requiredGates('autonomous')).toEqual([]);
    expect(requiredGates('plan')).toEqual(['plan']);
    expect(requiredGates('manual')).toEqual(['plan', 'action', 'review', 'release']);
    expect(modeRequiresGate('review', 'review')).toBe(true);
    expect(modeRequiresGate('plan', 'review')).toBe(false);
  });

  it('knows which direct transitions skip a gate request state', () => {
    expect(bypassedGates('workflow', 'draft', 'ready')).toEqual(['plan']);
    expect(bypassedGates('workflow', 'running', 'done')).toEqual(['review', 'release']);
    expect(bypassedGates('task', 'running', 'verified')).toEqual(['review']);
    expect(bypassedGates('workflow', 'ready', 'running')).toEqual([]);
  });

  it('blocks a bypass only when the mode requires that gate', () => {
    // plan mode must route draft -> awaiting_plan_approval, not straight to ready.
    expect(violatedGate('workflow', 'plan', 'draft', 'ready')).toBe('plan');
    // autonomous skips everything freely.
    expect(violatedGate('workflow', 'autonomous', 'running', 'done')).toBeNull();
    // release mode tolerates skipping the plan gate but not the release gate.
    expect(violatedGate('workflow', 'release', 'draft', 'ready')).toBeNull();
    expect(violatedGate('workflow', 'release', 'running', 'done')).toBe('release');
    // manual gates the task review bypass.
    expect(violatedGate('task', 'manual', 'running', 'verified')).toBe('review');
    expect(violatedGate('task', 'autonomous', 'running', 'verified')).toBeNull();
  });
});
