import { describe, it, expect } from 'vitest';
import {
  importWorkflowReducer,
  initialImportWorkflowState,
  isImportWorkflowBusy,
  type ImportWorkflowEvent,
} from './importWorkflow';

function run(events: ImportWorkflowEvent[]) {
  return events.reduce(importWorkflowReducer, initialImportWorkflowState);
}

describe('importWorkflowReducer', () => {
  it('handles cloud activation flow', () => {
    const state = run([
      { type: 'START_ACTIVATE_CLOUD', path: '/tmp/noted' },
      { type: 'ACTIVATE_SUCCESS' },
    ]);
    expect(state.stage).toBe('completed');
    expect(state.activeProviderPath).toBeNull();
    expect(state.error).toBeNull();
  });

  it('handles import success and failure', () => {
    const success = run([
      { type: 'START_IMPORT_VAULT' },
      { type: 'IMPORT_SUCCESS', count: 12 },
    ]);
    expect(success.status?.success).toBe(true);
    expect(success.status?.count).toBe(12);

    const failed = run([
      { type: 'START_IMPORT_APPLE' },
      { type: 'FAILED', message: 'boom' },
    ]);
    expect(failed.stage).toBe('failed');
    expect(failed.status?.success).toBe(false);
    expect(failed.error).toBe('boom');
  });

  it('reports busy stages correctly', () => {
    expect(isImportWorkflowBusy('activatingCloud')).toBe(true);
    expect(isImportWorkflowBusy('importingVault')).toBe(true);
    expect(isImportWorkflowBusy('importingAppleNotes')).toBe(true);
    expect(isImportWorkflowBusy('idle')).toBe(false);
  });
});
