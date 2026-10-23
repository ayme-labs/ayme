export {
  ACTION_RESULT_NOTE,
  runAction,
  startNavigation,
} from "./actionSequence";
export type { ActionFailure, ActionResult } from "./actionSequence";
export { renderChangeRecord } from "./changeRecord";
export { cursors } from "./cursors";
export type { Cursor } from "./cursors";
export {
  assertReachable,
  assertRootReachable,
  inTheWayOf,
  reaches,
} from "./elementReach";
export type { ElementInput } from "./elementReach";
export {
  capturePageState,
  configurePageStateIgnore,
  getInteractionHistory,
  getPageStateCaptureForDocument,
  getPageStateForDocument,
  getPageStateForElements,
  latestPageStateElement,
  latestPageStateRef,
  lookAtPageStateForDocument,
  onPageStateRecorded,
  pageStateNodeEntry,
  providePageObjectStructure,
  resolvePageStateRef,
  resolvePageStateRefs,
} from "./pageState";
export type {
  AriaRef,
  AymeNode,
  PageState,
  PageStateCapture,
  PageStateLook,
  RefResolution,
} from "./pageState";
export { inReachBatch, measurePomRoot } from "./reachMeasurement";
export { registerRefSelectorEngine } from "./refSelectorEngine";
export { refFailure, refHint, resolveRef, selectorFailure } from "./refTarget";
export {
  assertAvailable,
  obstructionReason,
  unavailableError,
} from "./toolAvailability";
export type { LatestRefLookup, ToolAvailability } from "./toolAvailability";
