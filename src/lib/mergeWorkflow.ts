export type MergeWorkflowStage =
  | 'idle'
  | 'readingTarget'
  | 'readingRelated'
  | 'savingMerged'
  | 'deletingRelated'
  | 'reopeningTarget'
  | 'completed'
  | 'failed';

export interface MergeWorkflowState {
  stage: MergeWorkflowStage;
  relatedProcessed: number;
  error: string | null;
}

export type MergeWorkflowEvent =
  | { type: 'START' }
  | { type: 'TARGET_READ' }
  | { type: 'RELATED_READ'; processed: number }
  | { type: 'SAVED' }
  | { type: 'DELETING_RELATED' }
  | { type: 'REOPENED' }
  | { type: 'FAILED'; message: string }
  | { type: 'RESET' };

export const initialMergeWorkflowState: MergeWorkflowState = {
  stage: 'idle',
  relatedProcessed: 0,
  error: null,
};

export function mergeWorkflowReducer(
  state: MergeWorkflowState,
  event: MergeWorkflowEvent,
): MergeWorkflowState {
  switch (event.type) {
    case 'START':
      return { stage: 'readingTarget', relatedProcessed: 0, error: null };
    case 'TARGET_READ':
      return { ...state, stage: 'readingRelated' };
    case 'RELATED_READ':
      return { ...state, stage: 'readingRelated', relatedProcessed: event.processed };
    case 'SAVED':
      return { ...state, stage: 'savingMerged' };
    case 'DELETING_RELATED':
      return { ...state, stage: 'deletingRelated' };
    case 'REOPENED':
      return { ...state, stage: 'completed' };
    case 'FAILED':
      return { ...state, stage: 'failed', error: event.message };
    case 'RESET':
      return initialMergeWorkflowState;
    default:
      return state;
  }
}
