export { INSPECTOR_DOGFOOD_ATTRIBUTE } from "./shared";
export {
  capturePageState,
  getPageStateForElements,
  lookAtPageStateForDocument,
  pageStateNodeEntry,
  resolvePageStateRef,
} from "./page-state";
export type { PageStateCapture, PageStateLook } from "./page-state";
export type {
  ProjectedStructuralNode,
  ProjectedStructuralNodeForest,
} from "@ayme-dev/core/structural-observation";
export {
  getPageContextForDocument,
  getPageContextTool,
  getPomDefinitionText,
  subscribeToAgentImageRuns,
} from "./tools";
export {
  agentDescription,
  createAymeRuntime,
  getPomDefinitions,
  inputSchemaFor,
  listAvailablePomTools,
  listCollectionToolItems,
  listRegisteredPoms,
  listRegisteredPomTargets,
  probeRegisteredPomMembers,
  registerCompiledPom,
  renderActionParameters,
  renderPomDefinitions,
  renderSchema,
  requireAymeRuntimePage,
  rootTargetPath,
  subscribeToRegisteredPoms,
} from "./page-objects";
// The compiled Page Object manifest the build plugin writes and the runtime
// reads; both ship together, so it is no public contract.
export type {
  PomComponentManifest,
  PomComponentMemberManifest,
  PomLocatorMemberManifest,
  PomManifest,
  PomMemberAccess,
  PomMemberManifest,
  ToolManifest,
  ToolParameter,
} from "./shared";
// How a tool reads to agents, so the Inspector shows what Ayme MCP gives them.
// The definition text's own rendering, so the Inspector shows an action's
// signature and argument types the way agents read them.
export {
  getAgentConnectionStatus,
  getAppProcessTools,
  getStartedAyme,
  listElementToolTargets,
  markRenderSession,
  sameRuntimeOptions,
  snapshotRuntimeOptions,
  subscribeToStartedAyme,
} from "./runtime";
export type {
  AgentConnectionStatus,
  AgentConnectionStatusSource,
  AppProcessTool,
  AppProcessTools,
  PublishedToolGroup,
  PublishedToolInfo,
} from "./runtime";
export type {
  CollectionToolItem,
  PageObjectConstructor,
  RegisteredPom,
  RegisteredPomTarget,
} from "./page-objects";
// The runtime's own input validation, so the Inspector's run card reports
// every violation before Run that the call would fail on.
export { toolInputViolations } from "@ayme-dev/core/tool-input";
export type { SchemaViolation } from "@ayme-dev/core/tool-input";
export type { AgentImageRun } from "./tools";
// The runtime session and its types are public (ADR-0031); this entry keeps
// the plugin's registration, the framework packages' fixed-options check and
// render-session marker, and the inspector's instrumentation, its way to the
// started session and its registry read model.
export { elementsOf, installRuntimePageInstrumentation, kindOf } from "./runs";
export { isPlaywrightLiteLocator as isAymeLocator } from "@ayme-dev/playwright-lite/internal";
// The Playwright call table: what every method of Locator, Page, Keyboard
// and Mouse does, so the Inspector's demo feedback reads the classification
// the runtime's Interaction recording reads.
export type { CallSubject } from "./runs";
