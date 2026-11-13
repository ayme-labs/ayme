import type { RecorderState } from "@ayme-dev/recorder/contract";

const THEN = { pause: "pausing", clear: "clearing", save: "saving" } as const;

/** What the recorder is doing, in words; "Connecting…" before the window
 * has heard its state. */
export function statusText(state: RecorderState | null): string {
  if (!state) return "Connecting…";
  switch (state.phase) {
    case "notRecording":
      return "Not recording";
    case "recording":
      return "Recording";
    case "wrappingUp":
      return `Wrapping up, then ${THEN[state.then]}`;
    case "paused":
      return "Paused";
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
