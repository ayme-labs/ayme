/** Why a recorder could not start. */
export type RecorderStartReason =
  /** No Playwright resolves from the project folder. */
  | "playwright-not-found"
  /** Playwright could not launch its browser. */
  | "browser-unavailable";

/**
 * The one way starting a recorder fails. Its message is a sentence for the
 * terminal; `reason` is for code.
 */
export class RecorderStartError extends Error {
  constructor(
    readonly reason: RecorderStartReason,
    message: string
  ) {
    super(message);
  }
}
