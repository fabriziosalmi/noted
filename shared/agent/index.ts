// Public surface of the agent-workflow runtime engine.
export * from './types';
export {
  canTransition,
  nextStatuses,
  isTerminal,
  isGateStatus,
  gateStateOf,
  gateStatesOf,
  statusesFor,
  isKnownStatus,
} from './stateMachine';
export { requiredGates, modeRequiresGate, bypassedGates, violatedGate } from './gates';
export {
  unmetDependencies,
  dependenciesSatisfied,
  isDependencyGatedTarget,
  indexTasks,
} from './dependencies';
export { readAgentMetadata, writeAgentMetadata } from './metadataBlock';
export {
  advance,
  approveGate,
  rejectGate,
  applyTaskStatusToWorkflow,
  effectiveMode,
  AgentEngineError,
} from './engine';
export type { EngineContext, EngineResult, EngineErrorCode } from './engine';
