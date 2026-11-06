export {
  createInPageHost,
  inPage,
  InPageVersionError,
  registerAymeRef,
} from "./host/inPage";
export { highlightStyles } from "./host/highlightStyles";
export type { HighlightStyle } from "./host/highlightStyles";
// Transitional (#1182): browser-only.
export { elementEverNamed, elementOfRef } from "./host/elementLookup";
// Browser-only: reach for the host in the document's own realm.
export { reachInRealm } from "./host/reachInRealm";
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
// The page part's ref world, for tests that stand in Playwright's snapshot
// where no browser lays the page out (jsdom).
export { createRefWorld } from "./page/capture";
export type { CaptureAriaSnapshot } from "./page/capture";
