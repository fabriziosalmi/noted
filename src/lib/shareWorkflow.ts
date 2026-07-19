export type ShareActionKind =
  | 'copyVaultToICloud'
  | 'exportVaultToFolder'
  | 'exportMarkdown'
  | 'exportPdf'
  | 'exportHtml'
  | 'exportDocx'
  | 'printNote'
  | 'shareNote'
  | 'saveAsGist';

export type ShareWorkflowStage =
  | 'idle'
  | 'runningAction'
  | 'gistConfirming'
  | 'gistSaving'
  | 'gistDone'
  | 'failed';

export interface ShareWorkflowState {
  stage: ShareWorkflowStage;
  action: ShareActionKind | null;
  gistPublic: boolean;
  gistUrl: string;
  error: string | null;
}

export type ShareWorkflowEvent =
  | { type: 'START_ACTION'; action: ShareActionKind }
  | { type: 'ACTION_SUCCESS' }
  | { type: 'ACTION_FAILED'; message: string }
  | { type: 'OPEN_GIST_CONFIRM' }
  | { type: 'SET_GIST_VISIBILITY'; isPublic: boolean }
  | { type: 'START_GIST_SAVE' }
  | { type: 'GIST_SAVED'; url: string }
  | { type: 'RESET' };

export const initialShareWorkflowState: ShareWorkflowState = {
  stage: 'idle',
  action: null,
  gistPublic: false,
  gistUrl: '',
  error: null,
};

export function shareWorkflowReducer(
  state: ShareWorkflowState,
  event: ShareWorkflowEvent,
): ShareWorkflowState {
  switch (event.type) {
    case 'START_ACTION':
      return {
        ...state,
        stage: 'runningAction',
        action: event.action,
        error: null,
      };
    case 'ACTION_SUCCESS':
      return {
        ...state,
        stage: 'idle',
        action: null,
        error: null,
      };
    case 'ACTION_FAILED':
      return {
        ...state,
        stage: 'failed',
        action: null,
        error: event.message,
      };
    case 'OPEN_GIST_CONFIRM':
      return {
        ...state,
        stage: 'gistConfirming',
        action: null,
        error: null,
        gistUrl: '',
      };
    case 'SET_GIST_VISIBILITY':
      return { ...state, gistPublic: event.isPublic };
    case 'START_GIST_SAVE':
      return { ...state, stage: 'gistSaving', action: 'saveAsGist', error: null };
    case 'GIST_SAVED':
      return {
        ...state,
        stage: 'gistDone',
        action: null,
        error: null,
        gistUrl: event.url,
      };
    case 'RESET':
      return initialShareWorkflowState;
    default:
      return state;
  }
}

export function isShareWorkflowBusy(stage: ShareWorkflowStage): boolean {
  return stage === 'runningAction' || stage === 'gistSaving';
}
