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
export {
  getPublicationStatus,
  listLiveTools,
  listPublishedTools,
  listElementToolTargets,
  subscribeToPublishedTools,
} from "./publishedTools";
export type { PublishedToolGroup, PublishedToolInfo } from "./publishedTools";
export {
  configureAymeRuntime,
  createAymeRuntime,
  createPageRegistration,
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
export { runTool, synchronizeWebMcpTools, waitForWebMcpDriver } from "./webMcp";
export type { WebMcpDriver, WebMcpRegistration } from "./webMcp";
// The runtime session and its types are public (ADR-0031); this entry keeps
// the plugin's registration and the inspector's instrumentation, its way to
// the started session and its registry read model.
export {
  createServerPageObject,
  getStartedAyme,
  installRuntimePageInstrumentation,
  subscribeToStartedAyme,
} from "./runtime";
export { isPlaywrightLiteLocator as isAymeLocator } from "@ayme-dev/playwright-lite/internal";
