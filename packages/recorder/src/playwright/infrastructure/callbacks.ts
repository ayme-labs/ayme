import type { RecorderWarning } from "../../contract";

/** That a report of Playwright's recorder is left out, as the adapter broke
 * on it. */
export const reportLost = (
  action: { readonly name?: unknown } | undefined,
  cause: unknown
): RecorderWarning => ({
  kind: "notRecorded",
  message: `A step is missing from the recording: the recorder could not read Playwright's report of a ${typeof action?.name === "string" ? action.name : "step"}. The trace still holds it. The recorder's error: ${cause instanceof Error ? cause.message : String(cause)}`,
});

/**
 * A callback for Playwright's recorder to hand a report to, that never
 * throws: Playwright calls it where nothing catches a throw, which would end
 * the process with nothing saved. A report the adapter breaks on is left
 * out, and `warn` tells a person, so the recorder goes on.
 */
export const reportedSafely =
  <Page, Action extends { readonly name?: unknown }>(
    warn: (warning: RecorderWarning) => void,
    callback: (page: Page, action: Action) => void
  ) =>
  (page: Page, action: Action): void => {
    try {
      callback(page, action);
    } catch (cause) {
      warn(reportLost(action, cause));
    }
  };
