export {
  createInPageHost,
  inPage,
  InPageVersionError,
  registerAymeRef,
} from "./host/inPage";
// Transitional (#1182): browser-only.
export { elementOfRef } from "./host/elementLookup";
// Browser-only: reach for the host in the document's own realm.
export { reachInRealm } from "./host/reachInRealm";
export type {
  Bound,
  Capture,
  CaptureOptions,
  ElementInputs,
  InPage,
  InPageHost,
  ReachMeasurement,
} from "./host/inPage";
// The page part's ref world, for tests that stand in Playwright's snapshot
// where no browser lays the page out (jsdom).
export { createRefWorld } from "./page/capture";
export type { CaptureAriaSnapshot } from "./page/capture";
