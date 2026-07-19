import { describe, it, expect } from 'vitest';
import {
  gitWorkflowReducer,
  initialGitWorkflowState,
  isGitWorkflowBusy,
  type GitWorkflowEvent,
} from './gitWorkflow';

function run(events: GitWorkflowEvent[]) {
  return events.reduce(gitWorkflowReducer, initialGitWorkflowState);
}

describe('gitWorkflowReducer', () => {
  it('tracks the PR publishing state machine end-to-end', () => {
    const state = run([
      { type: 'START_PR' },
      { type: 'PR_VALIDATED' },
      { type: 'BRANCH_PREPARED', branch: 'note/test' },
      { type: 'PUSHED' },
      { type: 'COMPLETED' },
    ]);
    expect(state.stage).toBe('completed');
    expect(state.branch).toBe('note/test');
    expect(state.error).toBeNull();
  });

  it('marks failures and can reset', () => {
    const failed = run([
      { type: 'START_COMMIT_NOTE' },
      { type: 'FAILED', message: 'commit failed' },
    ]);
    expect(failed.stage).toBe('failed');
    expect(failed.error).toBe('commit failed');

    const reset = gitWorkflowReducer(failed, { type: 'RESET' });
    expect(reset).toEqual(initialGitWorkflowState);
  });

  it('exposes busy state consistently', () => {
    expect(isGitWorkflowBusy('committingNote')).toBe(true);
    expect(isGitWorkflowBusy('pushingPrBranch')).toBe(true);
    expect(isGitWorkflowBusy('idle')).toBe(false);
    expect(isGitWorkflowBusy('failed')).toBe(false);
  });
});
