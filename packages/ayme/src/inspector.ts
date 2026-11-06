// The Inspector entry (ADR-0049): the Inspector contract, plain data only,
// and the runtime's inline serving of it. The Inspector is a client of this.
export { mergeInspectorState } from "./shared";
export type {
  AgentConnectionStatus,
  AppProcessTool,
  InspectorAgentImageRun,
  InspectorCommandResult,
  InspectorContract,
  InspectorEvent,
  InspectorHighlightLayer,
  InspectorInteraction,
  InspectorObserver,
  InspectorPublication,
  InspectorRun,
  InspectorState,
  ToolInfo,
} from "./shared";
export {
  createHighlights,
  createInspectorContract,
  inlineInspectorContract,
} from "./runtime";
export type {
  Highlightable,
  InspectorContractPorts,
  InspectorSession,
} from "./runtime";
