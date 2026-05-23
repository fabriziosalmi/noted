import { describe, it, expect } from 'vitest';
import {
  initialShareWorkflowState,
  isShareWorkflowBusy,
  shareWorkflowReducer,
  type ShareWorkflowEvent,
} from './shareWorkflow';

function run(events: ShareWorkflowEvent[]) {
  return events.reduce(shareWorkflowReducer, initialShareWorkflowState);
}

describe('shareWorkflowReducer', () => {
  it('handles generic share action transitions', () => {
    const state = run([
      { type: 'START_ACTION', action: 'exportPdf' },
      { type: 'ACTION_SUCCESS' },
    ]);
    expect(state.stage).toBe('idle');
    expect(state.action).toBeNull();
    expect(state.error).toBeNull();
  });

  it('tracks gist confirm/save/done flow', () => {
    const state = run([
      { type: 'OPEN_GIST_CONFIRM' },
      { type: 'SET_GIST_VISIBILITY', isPublic: true },
      { type: 'START_GIST_SAVE' },
      { type: 'GIST_SAVED', url: 'https://gist.github.com/x' },
    ]);
    expect(state.stage).toBe('gistDone');
    expect(state.gistPublic).toBe(true);
    expect(state.gistUrl).toBe('https://gist.github.com/x');
  });

  it('tracks failure and reset', () => {
    const failed = run([
      { type: 'START_ACTION', action: 'shareNote' },
      { type: 'ACTION_FAILED', message: 'share failed' },
    ]);
    expect(failed.stage).toBe('failed');
    expect(failed.error).toBe('share failed');

    const reset = shareWorkflowReducer(failed, { type: 'RESET' });
    expect(reset).toEqual(initialShareWorkflowState);
  });

  it('exposes busy state consistently', () => {
    expect(isShareWorkflowBusy('runningAction')).toBe(true);
    expect(isShareWorkflowBusy('gistSaving')).toBe(true);
    expect(isShareWorkflowBusy('gistConfirming')).toBe(false);
    expect(isShareWorkflowBusy('failed')).toBe(false);
  });
});
