export {
  createInPageHost,
  inPage,
  InPageVersionError,
  registerAymeRef,
} from "./host/inPage";
// Transitional (#1182): browser-only.
export { elementOfRef } from "./host/elementLookup";
export type {
  Bound,
  Capture,
  CaptureOptions,
  ElementInputs,
  InPage,
  InPageHost,
} from "./host/inPage";
// The page part's ref world, for tests that stand in Playwright's snapshot
// where no browser lays the page out (jsdom).
export { createRefWorld } from "./page/capture";
export type { CaptureAriaSnapshot } from "./page/capture";
