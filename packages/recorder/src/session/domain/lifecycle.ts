import type {
  CommandResult,
  RecorderCommand,
  RecorderState,
  RecordingOutcome,
} from "../../contract";

// The lifecycle of one recorder, as one pure function: the current state and
// one thing that happened in, the new state and a list of things to do out.
// It decides; the queue's worker and the browser adapter only carry out.

/** What the recorded browser tells the engine, in the engine's words. */
export type BrowserSignal =
  | { readonly kind: "pageClosed"; readonly pagesLeft: number }
  | { readonly kind: "browserGone" };

/** One thing that happened. Everything reaches the lifecycle as one of these. */
export type Happening =
  | BrowserSignal
  | { readonly kind: "command"; readonly command: RecorderCommand }
  /** The recorder is ended from outside: the terminal's stop. */
  | { readonly kind: "outsideEnd" };

/** One thing the worker carries out after a step. */
export type ToDo =
  /** Answer the command this step handled. */
  | { readonly kind: "reply"; readonly result: CommandResult }
  /** The recorder has ended: let the browser go and report the outcome. */
  | { readonly kind: "end"; readonly outcome: RecordingOutcome };

export type LifecycleState = RecorderState;

export const initialState: LifecycleState = { phase: "notRecording" };

const empty: RecordingOutcome = { kind: "empty" };

type Step = {
  readonly state: LifecycleState;
  readonly todo: readonly ToDo[];
};

export function step(state: LifecycleState, happening: Happening): Step {
  switch (happening.kind) {
    case "command":
      // No command applies yet in either state there is.
      return { state, todo: [{ kind: "reply", result: "ignored" }] };
    case "pageClosed":
      return happening.pagesLeft === 0 ? end(state) : { state, todo: [] };
    case "browserGone":
    case "outsideEnd":
      return end(state);
  }
}

/** An end from outside: with nothing recorded, the recorder ends "empty". */
function end(state: LifecycleState): Step {
  if (state.phase === "ended") return { state, todo: [] };
  return {
    state: { phase: "ended", outcome: empty },
    todo: [{ kind: "end", outcome: empty }],
  };
}
