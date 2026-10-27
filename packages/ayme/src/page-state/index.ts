export { ACTION_RESULT_NOTE, readRenderedChange } from "./domain/actionResult";
export type { ActionFailure, ActionResult } from "./domain/actionResult";
export { renderChangeRecord } from "./domain/changeRecord";
export { forkCursor, type Cursor } from "./domain/cursors";
export {
  assertReachable,
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
  getPageStateForDocument,
  getPageStateForElements,
  getPageStateSession,
  latestPageStateElement,
  latestPageStateRef,
  lookAtPageStateForDocument,
  onPageStateRecorded,
  providePageObjectStructure,
  resolvePageStateRef,
} from "./infrastructure/pageState";
export { geometryReach } from "./infrastructure/reachMeasurement";
export type { Reach, ReachMeasurement } from "./application/reach";
export { refFailure, refHint, selectorFailure } from "./domain/refFailures";
export { registerRefSelectorEngine } from "./infrastructure/refSelectorEngine";
export type { PageStateSession } from "./application/pageStateSession";
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
