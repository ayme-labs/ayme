// The Inspector entry (ADR-0049): the Inspector contract, plain data only, and
// the inline Inspector's way to the runtime's contract, through a slot on the
// document. Nothing here imports the runtime. The Inspector is a client of this.
export { inlineInspectorContract, mergeInspectorState } from "./shared";
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
// What the Inspector reads of its own side, with no runtime state: the types
// of the plain data it shows and the pure rules over it. The Inspector takes
// these from here, not from the runtime's root or internal entries (ADR-0049).
export { INSPECTOR_DOGFOOD_ATTRIBUTE } from "./shared";
export type {
  AgentConnectionStatusSource,
  AppProcessTools,
  AymeWebMcpPublicationStatus,
} from "./runtime";
export type {
  PublishedToolGroup,
  BuiltInCaller,
  Caller,
  InspectorLook,
  InspectorRecordedPageState,
  InspectorPageObject,
  InspectorRootedInstance,
  InspectorTarget,
  ControlState,
} from "./shared";
export type {
  DestructuredToolParameter,
  JsonPrimitive,
  JsonSchema,
  JsonValue,
  NamedToolParameter,
  PomComponentManifest,
  PomComponentMemberManifest,
  PomDefinition,
  PomLocatorMemberManifest,
  PomManifest,
  PomMemberAccess,
  PomMemberManifest,
  PomMemberObservation,
  RegisteredPomTool,
  ToolManifest,
  ToolParameter,
} from "./shared";
export type { ToolInput, ToolResult } from "./tools/domain";
export { callers } from "./shared";
export type { Interaction } from "./runs/domain";
export type { CallSubject } from "./runs/domain";
export type { Run } from "./runs/application";
export type {
  ProjectedStructuralNode,
  ProjectedStructuralNodeForest,
} from "@ayme-dev/core/structural-observation";
export type { SchemaViolation } from "@ayme-dev/core/tool-input";
export { pageStateNodeEntry } from "./page-state/domain";
export { toolInputViolations } from "@ayme-dev/core/tool-input";
export {
  inputSchemaFor,
  patternViolations,
  renderActionParameters,
  renderPomDefinitions,
  renderSchema,
  rootTargetPath,
  rootlessClassRefusals,
} from "./page-objects/domain";
