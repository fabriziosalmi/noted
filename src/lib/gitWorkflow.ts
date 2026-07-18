export type GitWorkflowStage =
  | 'idle'
  | 'initializing'
  | 'committingNote'
  | 'validatingPr'
  | 'preparingPrBranch'
  | 'pushingPrBranch'
  | 'creatingPr'
  | 'completed'
  | 'failed';

export interface GitWorkflowState {
  stage: GitWorkflowStage;
  branch: string | null;
  error: string | null;
}

export type GitWorkflowEvent =
  | { type: 'START_INIT' }
  | { type: 'START_COMMIT_NOTE' }
  | { type: 'START_PR' }
  | { type: 'PR_VALIDATED' }
  | { type: 'BRANCH_PREPARED'; branch: string }
  | { type: 'PUSHED' }
  | { type: 'COMPLETED' }
  | { type: 'FAILED'; message: string }
  | { type: 'RESET' };

export const initialGitWorkflowState: GitWorkflowState = {
  stage: 'idle',
  branch: null,
  error: null,
};

export function gitWorkflowReducer(
  state: GitWorkflowState,
  event: GitWorkflowEvent,
): GitWorkflowState {
  switch (event.type) {
    case 'START_INIT':
      return { stage: 'initializing', branch: null, error: null };
    case 'START_COMMIT_NOTE':
      return { stage: 'committingNote', branch: null, error: null };
    case 'START_PR':
      return { stage: 'validatingPr', branch: null, error: null };
    case 'PR_VALIDATED':
      return { ...state, stage: 'preparingPrBranch', error: null };
    case 'BRANCH_PREPARED':
      return { ...state, stage: 'pushingPrBranch', branch: event.branch };
    case 'PUSHED':
      return { ...state, stage: 'creatingPr' };
    case 'COMPLETED':
      return { ...state, stage: 'completed', error: null };
    case 'FAILED':
      return { ...state, stage: 'failed', error: event.message };
    case 'RESET':
      return initialGitWorkflowState;
    default:
      return state;
  }
}

export function isGitWorkflowBusy(stage: GitWorkflowStage): boolean {
  return !['idle', 'completed', 'failed'].includes(stage);
}
