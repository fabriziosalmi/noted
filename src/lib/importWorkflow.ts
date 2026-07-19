export type ImportWorkflowStage =
  | 'idle'
  | 'activatingCloud'
  | 'importingVault'
  | 'importingAppleNotes'
  | 'completed'
  | 'failed';

export interface ImportStatus {
  success: boolean;
  count: number;
  error?: string;
}

export interface ImportWorkflowState {
  stage: ImportWorkflowStage;
  activeProviderPath: string | null;
  status: ImportStatus | null;
  error: string | null;
}

export type ImportWorkflowEvent =
  | { type: 'START_ACTIVATE_CLOUD'; path: string }
  | { type: 'START_IMPORT_VAULT' }
  | { type: 'START_IMPORT_APPLE' }
  | { type: 'ACTIVATE_SUCCESS' }
  | { type: 'IMPORT_SUCCESS'; count: number }
  | { type: 'FAILED'; message: string }
  | { type: 'RESET' };

export const initialImportWorkflowState: ImportWorkflowState = {
  stage: 'idle',
  activeProviderPath: null,
  status: null,
  error: null,
};

export function importWorkflowReducer(
  state: ImportWorkflowState,
  event: ImportWorkflowEvent,
): ImportWorkflowState {
  switch (event.type) {
    case 'START_ACTIVATE_CLOUD':
      return {
        stage: 'activatingCloud',
        activeProviderPath: event.path,
        status: null,
        error: null,
      };
    case 'START_IMPORT_VAULT':
      return {
        stage: 'importingVault',
        activeProviderPath: null,
        status: null,
        error: null,
      };
    case 'START_IMPORT_APPLE':
      return {
        stage: 'importingAppleNotes',
        activeProviderPath: null,
        status: null,
        error: null,
      };
    case 'ACTIVATE_SUCCESS':
      return {
        ...state,
        stage: 'completed',
        activeProviderPath: null,
        error: null,
      };
    case 'IMPORT_SUCCESS':
      return {
        ...state,
        stage: 'completed',
        activeProviderPath: null,
        status: { success: true, count: event.count },
        error: null,
      };
    case 'FAILED':
      return {
        ...state,
        stage: 'failed',
        activeProviderPath: null,
        status: { success: false, count: 0, error: event.message },
        error: event.message,
      };
    case 'RESET':
      return initialImportWorkflowState;
    default:
      return state;
  }
}

export function isImportWorkflowBusy(stage: ImportWorkflowStage): boolean {
  return ['activatingCloud', 'importingVault', 'importingAppleNotes'].includes(stage);
}
