export {
  capturePageState,
  getPageStateForElements,
  peekPageStateForDocument,
  resolvePageStateRef,
} from "./pageState";
export type { PageStateCapture, PageStatePeek } from "./pageState";
export {
  getPageContextForDocument,
  getPageContextTool,
  getPomDefinitionText,
} from "./pageContext";
export { getPomDefinitions } from "./pomDefinitions";
export {
  getPublicationStatus,
  listPublishedTools,
  listRefToolTargets,
  runPublishedTool,
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
// The runtime session and its types are public (ADR-0025); this entry keeps
// the framework packages' server page objects, the plugin's registration and
// the inspector's instrumentation and registry read model.
export {
  createServerPageObject,
  installRuntimePageInstrumentation,
} from "./runtime";
export { isPlaywrightLiteLocator as isAymeLocator } from "@ayme-dev/playwright-lite/internal";
