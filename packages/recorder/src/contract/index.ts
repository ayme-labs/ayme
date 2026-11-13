// The plain data the engine shares with whoever drives or shows a recorder:
// the CLI, the window and the toolbar. Types only, no code: nothing here may
// need Node, Effect or Playwright.

/** How a recorder ended. A saved Recording Package joins "empty" with the
 * ticket that writes one. */
export type RecordingOutcome = {
  /** Nothing was recorded: no package was written. */
  readonly kind: "empty";
};

/** What the recorder is doing now. */
export type RecorderState =
  | { readonly phase: "notRecording" }
  | { readonly phase: "ended"; readonly outcome: RecordingOutcome };

/** A full picture of the recorder. `revision` grows with every change: a
 * receiver ignores an update whose revision is not above the last it applied. */
export type RecorderUpdate = {
  readonly revision: number;
  readonly state: RecorderState;
};

/** Something a person asks of the recorder. */
export type RecorderCommand = { readonly type: "finish" };

/** The answer to a command. One that does not apply now is "ignored": it
 * changes nothing, and is never queued or read as a toggle. */
export type CommandResult = "applied" | "ignored";
