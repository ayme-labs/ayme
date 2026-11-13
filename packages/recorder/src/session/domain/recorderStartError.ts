/** Why a recorder could not start. */
export type RecorderStartReason =
  /** No Playwright resolves from the project folder. */
  | "playwright-not-found"
  /** Playwright could not launch its browser. */
  | "browser-unavailable"
  /** The project's Playwright is older than the supported range. */
  | "playwright-too-old"
  /** The project's Playwright has no recorder the engine knows how to start. */
  | "playwright-recorder-not-found";

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
