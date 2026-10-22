export { ACTION_RESULT_NOTE } from "./actionResult";
export type { ActionFailure, ActionResult } from "./actionResult";
export { runAction } from "./actionSequence";
export { renderChangeRecord } from "./changeRecord";
export type { Cursor } from "./cursors";
export {
  assertReachable,
  assertRootReachable,
  inTheWayOf,
  reaches,
} from "./elementReach";
export type { ElementInput } from "./elementReach";
export { startNavigation } from "./navigation";
export {
  capturePageState,
  configurePageStateIgnore,
  cursors,
  getInteractionHistory,
  getPageStateCaptureForDocument,
  getPageStateForDocument,
  getPageStateForElements,
  latestPageStateElement,
  latestPageStateRef,
  lookAtPageStateForDocument,
  onPageStateRecorded,
  providePageObjectStructure,
  resolvePageStateRef,
  resolvePageStateRefs,
} from "./pageState";
export { inReachBatch, measurePomRoot } from "./reachMeasurement";
export { refFailure, refHint, selectorFailure } from "./refFailures";
export { registerRefSelectorEngine } from "./refSelectorEngine";
export { resolveRef } from "./refTarget";
export { pageStateNodeEntry } from "./structuralPageState";
export type {
  AriaRef,
  AymeNode,
  PageState,
  PageStateCapture,
  PageStateLook,
  RefResolution,
} from "./structuralPageState";
export {
  assertAvailable,
  obstructionReason,
  unavailableError,
} from "./toolAvailability";
export type { LatestRefLookup, ToolAvailability } from "./toolAvailability";
