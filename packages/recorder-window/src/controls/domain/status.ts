import type { RecorderState } from "@ayme-dev/recorder/contract";

const THEN = { pause: "pausing", clear: "clearing", save: "saving" } as const;

/** What the recorder is doing, in words, when the controls do not show it
 * already: "Connecting…" before the window has heard its state, the wrap-up,
 * the save and the end. None while it records, is paused or has not started:
 * the main control says that. */
export function statusText(state: RecorderState | null): string | null {
  if (!state) return "Connecting…";
  switch (state.phase) {
    case "notRecording":
    case "recording":
    case "paused":
      return null;
    case "wrappingUp":
      return `Wrapping up, then ${THEN[state.then]}`;
    case "saving":
      return "Saving the recording";
    case "ended":
      switch (state.outcome.kind) {
        case "saved":
          return `Saved ${state.outcome.folder}/package.yaml`;
        case "empty":
          return "Ended: nothing was recorded";
        case "failed":
          return `Failed: ${state.outcome.reason}`;
      }
  }
}
