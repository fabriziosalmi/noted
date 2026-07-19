import { describe, it, expect } from 'vitest';
import {
  initialMergeWorkflowState,
  mergeWorkflowReducer,
  type MergeWorkflowEvent,
} from './mergeWorkflow';

function run(events: MergeWorkflowEvent[]) {
  return events.reduce(mergeWorkflowReducer, initialMergeWorkflowState);
}

describe('mergeWorkflowReducer', () => {
  it('follows the expected happy-path state machine', () => {
    const state = run([
      { type: 'START' },
      { type: 'TARGET_READ' },
      { type: 'RELATED_READ', processed: 2 },
      { type: 'SAVED' },
      { type: 'DELETING_RELATED' },
      { type: 'REOPENED' },
    ]);

    expect(state.stage).toBe('completed');
    expect(state.relatedProcessed).toBe(2);
    expect(state.error).toBeNull();
  });

  it('tracks failures and resets cleanly', () => {
    const failed = run([
      { type: 'START' },
      { type: 'FAILED', message: 'save failed' },
    ]);
    expect(failed.stage).toBe('failed');
    expect(failed.error).toBe('save failed');

    const reset = mergeWorkflowReducer(failed, { type: 'RESET' });
    expect(reset).toEqual(initialMergeWorkflowState);
  });
});
