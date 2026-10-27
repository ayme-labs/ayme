export { assertReachable, inTheWayOf, reaches } from "./elementReach";
export type { ElementInput } from "./elementReach";
export { startNavigation } from "./navigation";
export {
  capturePageState,
  configurePageStateIgnore,
  cursors,
  getInteractionHistory,
  getPageStateForDocument,
  getPageStateForElements,
  getPageStateSession,
  latestPageStateElement,
  latestPageStateRef,
  lookAtPageStateForDocument,
  onPageStateRecorded,
  providePageObjectStructure,
  resolvePageStateRef,
} from "./pageState";
export { geometryReach } from "./reachMeasurement";
export { registerRefSelectorEngine } from "./refSelectorEngine";
