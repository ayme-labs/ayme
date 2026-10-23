export { ACTION_RESULT_NOTE, readRenderedChange } from "./domain/actionResult";
export type { ActionFailure, ActionResult } from "./domain/actionResult";
export { runAction } from "./infrastructure/actions";
export { renderChangeRecord } from "./domain/changeRecord";
export type { Cursor } from "./domain/cursors";
export {
  assertReachable,
  assertRootReachable,
  inTheWayOf,
  reaches,
} from "./infrastructure/elementReach";
export type { ElementInput } from "./infrastructure/elementReach";
export { startNavigation } from "./infrastructure/navigation";
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
} from "./infrastructure/pageState";
export {
  inReachBatch,
  measurePomRoot,
} from "./infrastructure/reachMeasurement";
export { refFailure, refHint, selectorFailure } from "./domain/refFailures";
export { registerRefSelectorEngine } from "./infrastructure/refSelectorEngine";
export { resolveRef } from "./infrastructure/refTarget";
export { pageStateNodeEntry } from "./domain/structuralPageState";
export type {
  AriaRef,
  AymeNode,
  PageState,
  PageStateCapture,
  PageStateLook,
  RefResolution,
} from "./domain/structuralPageState";
export {
  assertAvailable,
  obstructionReason,
  unavailableError,
} from "./domain/toolAvailability";
export type {
  LatestRefLookup,
  ToolAvailability,
} from "./domain/toolAvailability";
