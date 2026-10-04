export {
  capturePageState,
  getPageStateForElements,
  pageStateNodeEntry,
  peekPageStateForDocument,
  resolvePageStateRef,
} from "./pageState";
export type { PageStateCapture, PageStatePeek } from "./pageState";
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
export { listPublishedTools, listElementToolTargets } from "./publishedTools";
export type { PublishedToolGroup, PublishedToolInfo } from "./publishedTools";
export {
  configureAymeRuntime,
  createAymeRuntime,
  listRegisteredPomTools,
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
export { synchronizeWebMcpTools, waitForWebMcpDriver } from "./webMcp";
export type { WebMcpDriver, WebMcpRegistration } from "./webMcp";
// The runtime session and its types are public (ADR-0031); this entry keeps
// the plugin's registration, the framework packages' fixed-options check and
// the inspector's instrumentation, its way to the started session and its
// registry read model.
export {
  getStartedAyme,
  sameRuntimeOptions,
  subscribeToStartedAyme,
} from "./runtime";
export { installRuntimePageInstrumentation } from "./pageInstrumentation";
export { isPlaywrightLiteLocator as isAymeLocator } from "@ayme-dev/playwright-lite/internal";
