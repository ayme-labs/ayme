// Loads a stock Playwright by version and starts its recorder in API mode.
// The recorder API is private and moved between versions; this is the adapter.
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Stock installs live outside the repo so the prototype adds no dependency.
export const PW_ROOT =
  process.env.AYME_PW_ROOT ??
  "<scratchpad>/fork-experiments";

export function loadPlaywright(version = process.env.AYME_PW ?? "1.65") {
  // AYME_PW_DIR points straight at any playwright-core directory.
  const dir =
    process.env.AYME_PW_DIR ??
    path.join(PW_ROOT, `pw-${version}`, "node_modules", "playwright-core");
  const pw = require(dir);
  const real = require(path.join(dir, "package.json")).version;
  return { pw, version: real };
}

/** <=1.62 wraps the action as { pageGuid, action, startTime }; 1.63+ hands it bare. */
const actionOf = (raw) =>
  raw && raw.action && typeof raw.action === "object" && "name" in raw.action
    ? raw.action
    : raw;

/**
 * Starts Playwright's own recorder in API mode. `onEvent` gets
 * { kind: 'actionAdded' | 'actionUpdated' | 'signalAdded', page, action, code }.
 */
export async function startRecorder(context, onEvent) {
  const sink = {
    actionAdded: (page, raw, code) =>
      onEvent({ kind: "actionAdded", page, action: actionOf(raw), code }),
    actionUpdated: (page, raw, code) =>
      onEvent({ kind: "actionUpdated", page, action: actionOf(raw), code }),
    signalAdded: (page, raw, code) =>
      onEvent({ kind: "signalAdded", page, action: actionOf(raw), code }),
  };
  if (typeof context._startRecording === "function") {
    await context._startRecording({ language: "playwright-test" }, sink);
    return { api: "_startRecording", stop: () => context._stopRecording() };
  }
  await context._enableRecorder(
    { mode: "recording", recorderMode: "api", language: "playwright-test" },
    sink
  );
  return { api: "_enableRecorder", stop: () => context._disableRecorder() };
}

/** Hides Playwright's recorder toolbar and highlights; survives navigation. */
export const HIDE_OVERLAY = `(() => {
  const s = new CSSStyleSheet();
  s.replaceSync('x-pw-glass { display: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
})()`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
