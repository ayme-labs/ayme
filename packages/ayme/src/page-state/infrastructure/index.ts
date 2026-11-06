export { pageOfDocument } from "./browserInPage";
export { browserInPage } from "./browserInPage";
export {
  assertLocatorReachable,
  assertReachable,
  inTheWayOf,
  refsOfLocator,
} from "./elementReach";
export type { ElementInput } from "./elementReach";
export { startNavigation } from "./navigation";
export {
  capturePageState,
  configurePageStateFilters,
  configurePageStateIgnore,
  cursors,
  getInteractionHistory,
  getPageStateForDocument,
  getPageStateForElements,
  getPageStateSession,
  latestPageStateElement,
  latestPageStateCapture,
  latestPageStateRef,
  latestPageStateRefOf,
  latestPageStateRefNamed,
  lookAtPageStateForDocument,
  onPageStateRecorded,
  providePageObjectProbe,
  resolvePageStateRef,
} from "./pageState";
export { geometryReach } from "./reachMeasurement";
export { registerRefSelectorEngine } from "./refSelectorEngine";
