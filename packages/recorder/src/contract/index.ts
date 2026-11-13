// The plain data the engine shares with whoever drives or shows a recorder:
// the CLI, the window and the toolbar. Types only, no code: nothing here may
// need Node, Effect or Playwright.

/** How a recorder ended. */
export type RecordingOutcome =
  /** Nothing was recorded: no package was written. */
  | { readonly kind: "empty" }
  /** A Recording Package was written. `folder` is its folder, as an absolute
   * path: `package.yaml` is in it. */
  | { readonly kind: "saved"; readonly folder: string }
  /** The recorder broke down after it had started, as when the package
   * could not be written. `reason` says what went wrong, for a person. */
  | { readonly kind: "failed"; readonly reason: string };

/** What the recorder is doing now. */
export type RecorderPhase =
  | { readonly phase: "notRecording" }
  | { readonly phase: "recording" }
  /** Finishing what is under way before the recording is paused, cleared or
   * saved: commands are ignored meanwhile. `then` says which of the three
   * follows. */
  | { readonly phase: "wrappingUp"; readonly then: "pause" | "clear" | "save" }
  | { readonly phase: "saving" }
  | { readonly phase: "ended"; readonly outcome: RecordingOutcome }
  /** Stopped for now: nothing is recorded, and the page gets its input
   * untouched. What was recorded is kept, and Continue goes on from it. */
  | { readonly phase: "paused" };

/** One Interaction as it is recorded, and as the Recording Package lists it. */
export type InteractionDetails = {
  readonly id: string;
  /** Playwright's name for it: "click", "check" and so on. */
  readonly type: string;
  /** The target's Structural Ref; null when the target is not known in the
   * page's structure. */
  readonly targetRef: string | null;
  readonly targetSelector?: string;
  /** Whatever else Playwright said of it: the button, the modifiers and so on. */
  readonly [value: string]: unknown;
};

/** One entry of a Visit's timeline. A Change Tree is text, in the compact
 * notation of the Recording Package. */
export type TimelineEntry = (
  | {
      readonly kind: "interaction";
      /** Milliseconds on the recorded browser's monotonic clock. */
      readonly timestamp: number;
      readonly interaction: InteractionDetails;
      /** What it changed; null when it changed nothing, or when the page was
       * gone before that could be seen. */
      readonly changeTree: string | null;
    }
  /** What changed on the page with no Interaction to explain it. */
  | {
      readonly kind: "change";
      readonly timestamp: number;
      readonly changeTree: string;
    }
) & {
  /**
   * The entry's identity: the same in every update, after a reload of the
   * window and in the saved package, and the one a decision names. An
   * Interaction's is its own id. Whatever kind of entry is added, it has one.
   */
  readonly id: string;
  /** The person left it out of the recording. It stays where it is: what it
   * changed is still here, and the package writes it as a stub. Absent when
   * it is kept. */
  readonly discarded?: true;
};

/** One Visit of the recording, with the entries recorded in it so far. */
export type RecordedVisit = {
  readonly visitId: string;
  readonly url: string;
  /** Why it started. The first Visit of a recording is "initial". */
  readonly cause: "initial" | "navigate" | "openPage";
  /**
   * In the order they happened. An Interaction's entry joins when the
   * Interaction is complete; a change that belongs to no Interaction joins
   * with the next Interaction, or at the end of the recording.
   */
  readonly entries: readonly TimelineEntry[];
};

/** The recorder as it is now: what it is doing, and what it has recorded. */
export type RecorderState = RecorderPhase & {
  readonly visits: readonly RecordedVisit[];
  /** The commands that apply now: any other would be answered "ignored". */
  readonly commands: readonly RecorderCommandType[];
  /** What a person should know about how this recording is made, oldest
   * first. Each is told once. */
  readonly warnings: readonly RecorderWarning[];
};

/** Something a person should know about how a recording is made. */
export type RecorderWarning = {
  /**
   * What it is about, stable for code to tell warnings apart:
   * - reportShape: typing, a choice or an upload is recorded with what it
   *   changed up to its "after" only, as Playwright's report of it was not
   *   of the shape of a snapshot.
   * - playwrightUnverified: the project's Playwright is newer than the
   *   versions the recorder is verified on.
   * - traceWithoutPositions: the package carries its trace, but not the
   *   position numbers that open its snapshots.
   * - uploadNamesUnknown: an upload is recorded with its first file's name
   *   only, as the names of the others could not be read.
   */
  readonly kind:
    | "reportShape"
    | "playwrightUnverified"
    | "traceWithoutPositions"
    | "uploadNamesUnknown";
  /** A sentence for a person. */
  readonly message: string;
};

/** A full picture of the recorder. `revision` grows with every change: a
 * receiver ignores an update whose revision is not above the last it applied. */
export type RecorderUpdate = {
  readonly revision: number;
  readonly state: RecorderState;
};

/** Something a person asks of the recorder. */
export type RecorderCommand =
  | { readonly type: "record" }
  | { readonly type: "finish" }
  /** Pauses the recording. */
  | { readonly type: "stop" }
  /** Goes on recording after a pause, into the same timeline. */
  | { readonly type: "continue" }
  /** Throws away everything recorded so far. */
  | { readonly type: "clear" }
  /** While paused: leaves the entry out of the recording. It stays in the
   * timeline, marked, and Finish saves it as a stub. `entry` is the entry's
   * `id`. */
  | { readonly type: "discard"; readonly entry: string }
  /** While paused: puts a discarded entry back. */
  | { readonly type: "restore"; readonly entry: string };

/** The answer to a command. One that does not apply now is "ignored": it
 * changes nothing, and is never queued or read as a toggle. */
export type CommandResult = "applied" | "ignored";

/** The name of a command, as the state lists the ones that apply now. */
export type RecorderCommandType = RecorderCommand["type"];

/** What the in-page toolbar asks of the recorder. It calls the page function
 * named `ToolbarBinding` with one of these. */
export type ToolbarMessage =
  /** Answered with the command's `CommandResult`. */
  | { readonly kind: "send"; readonly command: RecorderCommand }
  /** Answered with the first `RecorderUpdate` whose revision is above
   * `after`: at once when there is one, or else when it comes. Answered with
   * null once the recorder has ended and the toolbar has been told so. */
  | { readonly kind: "update"; readonly after: number };

/** The name of the function the engine puts in every recorded page for the
 * toolbar. */
export type ToolbarBinding = "__aymeRecorderToolbar";
