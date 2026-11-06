export {
  createInPageHost,
  inPage,
  InPageVersionError,
  registerAymeRef,
} from "./host/inPage";
export { highlightStyles } from "./host/highlightStyles";
export {
  registerFilter,
  registerFilterThrough,
} from "./host/filterRegistration";
export type { FilterCheck } from "../shared";
export type { HighlightStyle } from "./host/highlightStyles";
export type {
  ActionInputs,
  ActionOptions,
  Bound,
  Capture,
  CaptureOptions,
  ElementInputs,
  ElementReads,
  InPage,
  InPageAction,
  InPageHost,
  ReachMeasurement,
  PickOptions,
  VisitSignal,
  RootState,
} from "./host/inPage";
export type { CaptureAriaSnapshot } from "./page/capture";
