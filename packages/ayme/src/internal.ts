export {
  INSPECTOR_DOGFOOD_ATTRIBUTE,
  capturePageState,
  getPageStateForElements,
  pageStateNodeEntry,
  lookAtPageStateForDocument,
  resolvePageStateRef,
} from "./pageState";
export type { PageStateCapture, PageStateLook } from "./pageState";
export type {
  ProjectedStructuralNode,
  ProjectedStructuralNodeForest,
} from "@ayme-dev/core/structural-observation";
export {
  getPageContextForDocument,
  getPageContextTool,
  getPomDefinitionText,
} from "./pageContext";
export { getPomDefinitions } from "./pomDefinitions";
// The definition text's own rendering, so the Inspector shows an action's
// signature and argument types the way agents read them.
export {
  renderActionParameters,
  renderPomDefinitions,
  renderSchema,
} from "./pomDefinitionText";
export { listElementToolTargets } from "./publishedTools";
export type { PublishedToolGroup, PublishedToolInfo } from "./publishedTools";
export {
  configureAymeRuntime,
  createAymeRuntime,
  listAvailablePomTools,
  listRegisteredPomTargets,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerCompiledPom,
  subscribeToRegisteredPoms,
  requireAymeRuntimePage,
} from "./registry";
export type {
  PageObjectConstructor,
  RegisteredPom,
  RegisteredPomTarget,
} from "./registry";
// The runtime's own input validation, so the Inspector's run card reports
// every violation before Run that the call would fail on.
export { toolInputViolations } from "./schemaValidation";
export type { SchemaViolation } from "./schemaValidation";
export { subscribeToAgentImageRuns } from "./agentImageRuns";
export type { AgentImageRun } from "./agentImageRuns";
// The runtime session and its types are public (ADR-0031); this entry keeps
// the plugin's registration, the framework packages' fixed-options check and
// render-session marker, and the inspector's instrumentation, its way to the
// started session and its registry read model.
export {
  getAppProcessTools,
  getStartedAyme,
  markRenderSession,
  sameRuntimeOptions,
  subscribeToStartedAyme,
} from "./runtime";
export type { AppProcessTool, AppProcessTools } from "./runtime";
export { installRuntimePageInstrumentation } from "./pageInstrumentation";
export { isPlaywrightLiteLocator as isAymeLocator } from "@ayme-dev/playwright-lite/internal";
