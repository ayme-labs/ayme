import type {
  CommandResult,
  RecorderCommand,
  RecorderCommandType,
  RecorderPhase,
  RecorderWarning,
  RecordingOutcome,
} from "../../contract";
import type {
  InteractionReport,
  PageSnapshot,
  RecordingTrace,
  TimelineAddition,
  VisitCause,
} from "../../timeline/domain";

// The lifecycle of one recorder, as one pure function: the current state and
// one thing that happened in, the new state and a list of things to do out.
// It decides; the queue's worker and the browser adapter only carry out.

/**
 * What the recorded browser tells the engine, in the engine's words: what it
 * noticed by itself, and what came of each thing it was asked. One stream,
 * in the order it happened.
 */
export type BrowserSignal =
  | { readonly kind: "pageOpened"; readonly page: string; readonly url: string }
  /** The page's main frame is at another address. */
  | {
      readonly kind: "pageNavigated";
      readonly page: string;
      readonly url: string;
    }
  | {
      readonly kind: "pageClosed";
      readonly page: string;
      readonly pagesLeft: number;
    }
  | { readonly kind: "browserGone" }
  /** Playwright reports Interactions from now on, or no longer does. */
  | { readonly kind: "reportingInteractions"; readonly on: boolean }
  /** Every page confirms that it holds inputs back, or that it no longer does. */
  | { readonly kind: "inputsHeld"; readonly on: boolean }
  /** A page held an input back: it has not reached the page yet. */
  | {
      readonly kind: "inputHeld";
      readonly input: string;
      readonly page: string;
      /** What was held; a click of count one when it is not said. */
      readonly held?: HeldInput;
    }
  | { readonly kind: "snapshotTaken"; readonly snapshot: PageSnapshot }
  /** A held input has reached its page. `at` is on the clock of snapshots. */
  | {
      readonly kind: "inputPassedOn";
      readonly input: string;
      readonly at: number;
    }
  /** The wait asked for after `input` is over: the page is a Settled Page, or
   * the wait's deadline passed. */
  | {
      readonly kind: "pageSettled";
      readonly page: string;
      readonly input: string;
    }
  /** Playwright reported an Interaction, some time after the input. */
  | {
      readonly kind: "interactionReported";
      readonly page: string;
      readonly report: InteractionReport;
    }
  /** Playwright revised the Interaction it reported last on the page, as it
   * does with each key typed into the same field. */
  | {
      readonly kind: "interactionRevised";
      readonly page: string;
      readonly report: InteractionReport;
    }
  /** A request broke while the browser carried it out, or the time it was
   * given for its answer has passed: no other answer to it is waited for.
   * `reason` says what went wrong, for a person. */
  | {
      readonly kind: "requestFailed";
      readonly request: BrowserRequest;
      readonly reason: string;
    }
  /** The trace is stopped and kept, as "stopTrace" asked. */
  | { readonly kind: "traceStopped"; readonly trace: RecordingTrace }
  // Visits.
  /** A held input can no longer reach its page: the document it was held
   * in is gone. Told instead of "inputPassedOn". */
  | { readonly kind: "inputGone"; readonly input: string }
  // Warnings.
  /** Something a person should know about how the recording is made. */
  | { readonly kind: "browserWarned"; readonly warning: RecorderWarning }
  // Assert visibility.
  /** Playwright's recorder is in its picking mode now, or no longer is,
   * whoever switched it: it leaves it by itself once the element is picked. */
  | { readonly kind: "picking"; readonly on: boolean }
  // Highlight.
  /** The browser drew the highlight asked for, or found no element for it
   * for certain and drew nothing. */
  | {
      readonly kind: "highlighted";
      readonly highlight: number;
      readonly found: boolean;
    }
  // The trace's order.
  /** The trace is started, as "startTrace" asked: snapshots may be marked. */
  | { readonly kind: "traceStarted" }
  /** The trace is thrown away, as "stopTrace" without `keep` asked. */
  | { readonly kind: "traceDiscarded" };

/** The element a highlight is drawn on, as the page now names it: by the
 * ref its latest snapshot gave it, or, for a target with no ref, by its
 * selector. */
export type HighlightTarget = {
  readonly page: string;
  readonly ref: string | null;
  readonly selector: string | null;
};

/** What a page held back. */
export type HeldInput =
  /** A click of the mouse; `count` is 2 for the second click of a double
   * click. */
  | { readonly kind: "click"; readonly count: number }
  /** A key press that Playwright records as a press, not as typing.
   * `nothingFocused`: it went to the page itself, as no element had focus. */
  | { readonly kind: "press"; readonly nothingFocused?: boolean }
  /** A key typed while an earlier input was held: it waits its turn. */
  | { readonly kind: "typing" };

/**
 * One thing the engine asks of the recorded browser. The browser takes a
 * request and returns at once; what comes of it is told later, as a
 * `BrowserSignal`. Two requests that must follow each other are therefore
 * two steps: the second is asked when the first is answered.
 */
export type BrowserRequest =
  /** Have Playwright report Interactions from now on, or no longer: its own
   * recorder is switched on or off. Answered by "reportingInteractions". */
  | { readonly kind: "reportInteractions"; readonly on: boolean }
  /** Hold inputs back in every page, or stop doing so. Answered by
   * "inputsHeld" once every page has confirmed. A page that stops also
   * stops holding what follows a held input, once nothing it held waits to
   * be passed on. */
  | { readonly kind: "holdInputs"; readonly on: boolean }
  /** Answered by "snapshotTaken" with a snapshot of this id. */
  | {
      readonly kind: "takeSnapshot";
      readonly snapshot: string;
      readonly page: string;
    }
  /** Let a held input reach its page. Answered by "inputPassedOn". */
  | { readonly kind: "passOn"; readonly input: string }
  /** Wait until the page is a Settled Page. Answered by "pageSettled". */
  | {
      readonly kind: "waitForSettled";
      readonly page: string;
      readonly input: string;
    }
  /**
   * A page that held an input holds everything after it, typing included,
   * and so does a page from Record until its first input. This lets what
   * follows reach the page again, unless the page held an input after
   * `upTo`, the last one the engine knows of; null when it knows none.
   * Nothing answers it.
   */
  | {
      readonly kind: "letInputsThrough";
      readonly page: string;
      readonly upTo: string | null;
    }
  /** Start the recording's one trace. Answered by "traceStarted". */
  | { readonly kind: "startTrace" }
  /** Stop the trace. Kept, it is answered by "traceStopped"; thrown away, by
   * "traceDiscarded". The browser holds neither request back behind another
   * of its own: the lifecycle asks for the next one when the last is
   * answered. */
  | { readonly kind: "stopTrace"; readonly keep: boolean }
  // Assert visibility.
  /** Have Playwright's recorder pick the element whose visibility is
   * asserted, or stop picking, and have every page leave the picking click
   * alone meanwhile: it is Playwright's, and never reaches the page. Picking
   * that starts is answered by "picking"; one that is asked to stop needs no
   * answer. */
  | { readonly kind: "pick"; readonly on: boolean }
  // Highlight.
  /** Draw the recorder's own highlight on this element of the page, in
   * place of any other, or on none. Drawn only while no later highlight was
   * asked. One on an element is answered by "highlighted"; one on none needs
   * no answer. */
  | {
      readonly kind: "highlight";
      readonly highlight: number;
      readonly target: HighlightTarget | null;
    };

/** One thing that happened. Everything reaches the lifecycle as one of these. */
export type Happening =
  | BrowserSignal
  | { readonly kind: "command"; readonly command: RecorderCommand }
  /** The recorder is ended from outside: the terminal's stop. */
  | { readonly kind: "outsideEnd" }
  /** The time limit a "startTimeLimit" started has passed. */
  | { readonly kind: "timeLimitPassed" }
  /** A "save" is done. `folder` is the package's folder, or null when there
   * was nothing to save. */
  | { readonly kind: "saved"; readonly folder: string | null }
  /** The recorder cannot go on: something it was carrying out broke. */
  | { readonly kind: "brokeDown"; readonly reason: string }
  // Warnings.
  /** The timeline made something of the recording a person should know of. */
  | { readonly kind: "timelineWarned"; readonly warning: RecorderWarning }
  // Highlight.
  /** The timeline found the element of the entry a highlight names, as the
   * page now names it; null when it is gone, of an earlier Visit, or not
   * known for certain. */
  | {
      readonly kind: "located";
      readonly highlight: number;
      readonly target: HighlightTarget | null;
    };

/** One thing the worker carries out after a step, in the list's order. */
export type ToDo =
  /** Answer the command this step handled. */
  | { readonly kind: "reply"; readonly result: CommandResult }
  /** Keep the answer to the command this step handled for a later step. */
  | { readonly kind: "deferReply" }
  /** Give the answer that was kept. */
  | { readonly kind: "replyDeferred"; readonly result: CommandResult }
  | {
      readonly kind: "browser";
      readonly ask: BrowserRequest;
      /**
       * How long the answer may take. When that has passed and the lifecycle
       * still waits for it (`awaitsAnswer`), the lifecycle is told
       * "requestFailed" for the request, as when the browser says that it
       * could not: a browser that answers nothing keeps no state waiting
       * for ever.
       */
      readonly within?: number;
    }
  | { readonly kind: "timeline"; readonly add: TimelineAddition }
  /** Tell the lifecycle "timeLimitPassed" after this long. */
  | { readonly kind: "startTimeLimit"; readonly ms: number }
  /** Write the Recording Package, with the trace when there is one, then
   * tell the lifecycle "saved". */
  | { readonly kind: "save"; readonly trace?: RecordingTrace }
  /** The recorder has ended: let the browser go and report the outcome. */
  | { readonly kind: "end"; readonly outcome: RecordingOutcome }
  /** Throw away everything recorded: the timeline starts empty again. */
  | { readonly kind: "clear" }
  // Warnings.
  /** Tell every subscriber of a warning, once. */
  | { readonly kind: "warn"; readonly warning: RecorderWarning }
  // Highlight.
  /** Ask the timeline where the element of an entry is now, then tell the
   * lifecycle "located". */
  | {
      readonly kind: "locate";
      readonly entry: string;
      readonly highlight: number;
    }
  /** Keep the answer to the command this step handled under `key`, beside
   * any other kept: highlights come one after another. */
  | { readonly kind: "keepReply"; readonly key: string }
  /** Give the answer kept under `key`. */
  | {
      readonly kind: "replyKept";
      readonly key: string;
      readonly result: CommandResult;
    };

/**
 * How long a wrap-up may take. It is there for a report that never comes:
 * Playwright reports a click about half a second late, and a Settled Page
 * can take two seconds.
 */
export const WRAP_UP_LIMIT_MS = 5_000;

/**
 * How long stopping a trace may take, kept or thrown away: Playwright writes
 * the file, and the stock trace tool reads the snapshots' positions from it.
 * It is there for a browser that never answers: the package is then written
 * without its trace, and a cleared recording is over all the same.
 */
export const TRACE_STOP_LIMIT_MS = 60_000;

/**
 * Whether the state still waits for the answer to a request that was given
 * a time for it (`within`). The worker ends the time of a request that is no
 * longer waited for, so that it cannot pass for a later one of its kind.
 */
export function awaitsAnswer(
  state: LifecycleState,
  request: BrowserRequest
): boolean {
  if (request.kind !== "stopTrace") return false;
  return request.keep
    ? state.phase === "saving" && state.stoppingTrace
    : state.phase === "wrappingUp" && state.discardingTrace;
}

/** The reports a held click can lead to. */
const HELD_CLICK_REPORTS = new Set(["click", "check", "uncheck"]);

/** The reports of inputs the gate never holds: their "before" comes from
 * the report's own picture of the page. */
const REPORTED_ONLY = new Set(["fill", "select", "setInputFiles"]);

/** The kind of held input a report belongs to, if any. */
function heldKindOf(report: InteractionReport): HeldInput["kind"] | null {
  if (HELD_CLICK_REPORTS.has(report.type)) return "click";
  if (report.type === "press") return "press";
  return null;
}

type Page = {
  readonly id: string;
  readonly url: string;
  /** What became of it while it had no Visit at its address: it opened,
   * blank while recording or while paused, or it went elsewhere while
   * paused, or it was blank when Record started a recording that has no
   * Visit yet, so that its Visit is the first. Its Visit starts when it is
   * at an address while recording. */
  readonly since?: "opened" | "moved" | "blankAtRecord";
};

/** One input the gate held back, until it is written down or dropped. */
type Input = {
  readonly id: string;
  readonly page: string;
  /** What the page held back, or "reported" for an input the gate never
   * holds, known from Playwright's report only. */
  readonly held:
    | HeldInput
    | { readonly kind: "reported" }
    /** An assertion Playwright reported. Its one snapshot is its "before"
     * and its "after". */
    | { readonly kind: "asserted" };
  /** Its report was revised while its "after" was being taken. */
  readonly revised: boolean;
  /** The input whose report covers this one too, as the first click of a
   * double click covers the second. */
  readonly joins: string | null;
  /** Its report is not coming: a later input of its page was reported
   * first, and Playwright reports in order. It is left out. */
  readonly unreported: boolean;
  /**
   * - waiting: behind an earlier input of its page.
   * - takingBefore, takingAfter: the snapshot `asked` is under way.
   * - passingOn: it is on its way to the page.
   * - settling: the page is given time to become a Settled Page.
   * - settled: it has its "after", or its page is gone.
   */
  readonly stage:
    | "waiting"
    | "takingBefore"
    | "passingOn"
    | "settling"
    | "takingAfter"
    | "settled";
  readonly asked: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly passedOnAt: number | null;
  readonly report: InteractionReport | null;
};

/** What a started recording keeps track of. */
type Flow = {
  /** Oldest first. */
  readonly inputs: readonly Input[];
  readonly snapshotsAsked: number;
  /** Of each page: whether it holds everything that follows, and its
   * latest snapshot. */
  readonly gates: readonly PageGate[];
  /** How many inputs were known from Playwright's report only. */
  readonly reportedOnly: number;
};

type PageGate = {
  readonly page: string;
  /** The page holds what follows, typing included, until it is let through. */
  readonly holding: boolean;
  /** The last input the page held. */
  readonly upTo: string | null;
  /** The latest snapshot of the page. */
  readonly latest: { readonly id: string; readonly at: number } | null;
  /** The page's next snapshot is its first since a pause: it is where
   * recording resumes, the new point to compare from. */
  readonly resumes?: boolean;
  /** The snapshot asked for at Continue to be that one, while it is under
   * way. */
  readonly resuming?: string | null;
};

export type LifecycleState = {
  readonly pages: readonly Page[];
  /** How many highlights were asked: the latest is the one drawn. It goes
   * from one phase to the next. */
  readonly highlights?: number;
} & (
  | { readonly phase: "notRecording" }
  | ({
      readonly phase: "recording";
      /** Record is not answered yet: the pages do not all hold inputs back. */
      readonly starting: boolean;
      /** It goes on after a pause: Continue started it, not Record. */
      readonly resumed: boolean;
      /** Assert visibility. */
      readonly picking: Picking;
      /** The trace Record asked for is not started yet. */
      readonly traceStarting: boolean;
    } & Flow)
  | ({
      readonly phase: "wrappingUp";
      /** Every page confirmed that it holds no input back any more. */
      readonly gateOff: boolean;
      /** The last snapshots still under way; null until they are asked for. */
      readonly finals: readonly { page: string; snapshot: string }[] | null;
      /** What the wrap-up leads to. */
      readonly then: AfterWrapUp;
      /** All that was under way is done, and Playwright's recorder is asked
       * to switch off: the wrap-up waits for nothing else. */
      readonly switchingOff: boolean;
      /** The trace Record asked for is not started yet. */
      readonly traceStarting: boolean;
      /** The trace of a recording that is thrown away is asked to stop: the
       * recording is over once it has. */
      readonly discardingTrace: boolean;
    } & Flow)
  | {
      readonly phase: "saving";
      /** The trace is asked to stop: the package is written once it has. */
      readonly stoppingTrace: boolean;
    }
  | { readonly phase: "ended"; readonly outcome: RecordingOutcome }
  /** Nothing is under way. The count of snapshots goes on after Continue:
   * the timeline is the same one. */
  | { readonly phase: "paused"; readonly snapshotsAsked: number }
);

/**
 * What a wrap-up leads to: the package is saved and the recorder ends; the
 * recorder is paused; everything recorded is thrown away, and the recorder
 * is not recording again; or it is thrown away and the recorder ends
 * "empty", when a clearing recorder is ended from outside.
 */
type AfterWrapUp = "save" | "pause" | "clear" | "clearAndEnd";

type Active = Extract<LifecycleState, { phase: "recording" | "wrappingUp" }>;

/**
 * Where Assert visibility stands while recording: off; asked for while an
 * input is held, which picking would swallow when it is passed on; asked of
 * Playwright; or Playwright is in its picking mode.
 */
type Picking = "off" | "waiting" | "asked" | "on";

export const initialState: LifecycleState = {
  phase: "notRecording",
  pages: [],
};

/** The phase a state shows outside the engine. */
export function shown(state: LifecycleState): RecorderPhase {
  switch (state.phase) {
    case "ended":
      return { phase: "ended", outcome: state.outcome };
    case "wrappingUp":
      // A recorder that clears and then ends is shown clearing: what it
      // ends with is told when it has ended.
      return {
        phase: "wrappingUp",
        then: state.then === "clearAndEnd" ? "clear" : state.then,
      };
    case "recording":
      // Record, or Continue, is not answered yet: until Playwright reports
      // and every page holds inputs back, a click is not recorded, so the
      // recorder is not shown recording (rule 13).
      if (state.starting)
        return { phase: state.resumed ? "paused" : "notRecording" };
      return state.picking === "on"
        ? { phase: "recording", picking: true }
        : { phase: "recording" };
    default:
      return { phase: state.phase };
  }
}

const COMMANDS: readonly RecorderCommandType[] = [
  "record",
  "finish",
  "stop",
  "continue",
  "clear",
  "discard",
  "restore",
  // Assert visibility.
  "assertVisibility",
  "leaveAssertVisibility",
  // Highlight.
  "highlight",
  "clearHighlight",
];

/** A command of this type, to ask whether it applies: the answer does not
 * depend on which entry it names. */
const probe = (type: RecorderCommandType): RecorderCommand =>
  type === "discard" || type === "restore" || type === "highlight"
    ? { type, entry: "" }
    : { type };

/** The commands that apply in a state: those the lifecycle would not answer
 * "ignored". The window offers these, and no rule of its own. */
export function offered(state: LifecycleState): RecorderCommandType[] {
  return COMMANDS.filter(
    (type) =>
      !command(state, probe(type)).todo.some(
        (item) => item.kind === "reply" && item.result === "ignored"
      )
  );
}

type Step = {
  readonly state: LifecycleState;
  readonly todo: readonly ToDo[];
};

const stay = (state: LifecycleState): Step => ({ state, todo: [] });
const isActive = (state: LifecycleState): state is Active =>
  state.phase === "recording" || state.phase === "wrappingUp";
/** A wrap-up whose recording is thrown away, and whose trace is asked to
 * stop: the recording is over when that is answered. */
const discarding = (state: LifecycleState) =>
  state.phase === "wrappingUp" && state.discardingTrace;

export function step(state: LifecycleState, happening: Happening): Step {
  const next = stepOf(state, happening);
  const highlights = next.state.highlights ?? state.highlights ?? 0;
  // A highlight is drawn only while recording or paused: what is drawn is
  // cleared when the recorder leaves both.
  const leaves =
    highlights > 0 &&
    reviewable(state) &&
    !reviewable(next.state) &&
    next.state.phase !== "ended";
  return {
    state: { ...next.state, highlights: leaves ? highlights + 1 : highlights },
    todo: leaves
      ? [...next.todo, drawHighlight(highlights + 1, null)]
      : next.todo,
  };
}

function stepOf(state: LifecycleState, happening: Happening): Step {
  switch (happening.kind) {
    case "command":
      return command(state, happening.command);
    case "outsideEnd":
    case "browserGone":
      return endFromOutside(state);
    case "pageOpened": {
      const page: Page = { id: happening.page, url: happening.url };
      const opened = { ...state, pages: [...state.pages, page] };
      if (isActive(opened) && page.url !== BLANK)
        return proceed(opened, [visitOf(page.id, page.url, "openPage")]);
      return stay(
        isActive(opened) || opened.phase === "paused"
          ? { ...opened, pages: [...state.pages, { ...page, since: "opened" }] }
          : opened
      );
    }
    case "pageNavigated": {
      const page = state.pages.find((open) => open.id === happening.page);
      if (!page) return stay(state);
      const at = { ...page, url: happening.url };
      const moved = (next: Page) => ({
        ...state,
        pages: state.pages.map((open) => (open === page ? next : open)),
      });
      if (isActive(state) && at.url !== BLANK)
        return proceed(
          {
            ...state,
            pages: state.pages.map((open) =>
              open === page ? visited(at) : open
            ),
          },
          [visitOf(at.id, at.url, causeOf(at))]
        );
      return stay(
        moved(
          state.phase === "paused" ? { ...at, since: at.since ?? "moved" } : at
        )
      );
    }
    case "pageClosed": {
      const without = withoutPage(state, happening.page);
      if (happening.pagesLeft === 0) return endFromOutside(without);
      return isActive(without) ? proceed(without, []) : stay(without);
    }
    case "brokeDown": {
      // Whatever it was doing, it ends here, and says why.
      if (state.phase === "ended") return stay(state);
      const outcome: RecordingOutcome = {
        kind: "failed",
        reason: happening.reason,
      };
      return {
        state: { phase: "ended", pages: state.pages, outcome },
        todo: [...answerRecord(state), { kind: "end", outcome }],
      };
    }
    // Warnings: a person is told, whatever the recorder is doing.
    case "browserWarned":
    case "timelineWarned":
      return { state, todo: [{ kind: "warn", warning: happening.warning }] };
    case "timeLimitPassed":
      return state.phase === "wrappingUp" ? giveUp(state) : stay(state);
    case "requestFailed":
      return failed(state, happening.request, happening.reason);
    case "traceStopped":
      return writePackage(state, happening.trace);
    case "traceDiscarded":
      return traceGone(state);
    case "picking":
      return pickingChanged(state, happening.on);
    case "located":
      return located(state, happening.highlight, happening.target);
    case "highlighted":
      return answerHighlight(
        state,
        happening.highlight,
        happening.found ? "applied" : "notFound"
      );
    case "saved": {
      if (state.phase !== "saving") return stay(state);
      const outcome: RecordingOutcome =
        happening.folder === null
          ? { kind: "empty" }
          : { kind: "saved", folder: happening.folder };
      return {
        state: { phase: "ended", pages: state.pages, outcome },
        todo: [{ kind: "end", outcome }],
      };
    }
    default:
      // A recording whose trace is being thrown away is over: what the pages
      // still tell is not of it.
      return isActive(state) && !discarding(state)
        ? during(state, happening)
        : aside(state, happening);
  }
}

/** What the browser tells while no recording is under way. */
function aside(state: LifecycleState, happening: BrowserSignal): Step {
  // A page that had not heard in time that recording is over held a click
  // back: it is the page's, and reaches it now. Nothing of it is recorded.
  if (happening.kind === "inputHeld" && state.phase !== "ended")
    return {
      state,
      todo: [
        { kind: "browser", ask: { kind: "passOn", input: happening.input } },
      ],
    };
  return stay(state);
}

/** The pages' gates as Record or Continue leaves them: holding what
 * follows until each page's first input has a "before". */
const freshGates = (pages: readonly Page[]): PageGate[] =>
  pages.map((page) => ({
    page: page.id,
    holding: true,
    upTo: null,
    latest: null,
  }));

function command(state: LifecycleState, asked: RecorderCommand): Step {
  const reply = (result: CommandResult): ToDo => ({ kind: "reply", result });
  if (asked.type === "highlight" || asked.type === "clearHighlight")
    return reviewable(state)
      ? highlight(state, asked)
      : { state, todo: [reply("ignored")] };
  /** A command that starts a wrap-up is answered at once: the buttons wait
   * for the phase, not for the answer. */
  const applied = (next: Step): Step => ({
    state: next.state,
    todo: [...next.todo, reply("applied")],
  });
  switch (state.phase) {
    case "notRecording":
      if (asked.type === "record" && state.pages.length > 0)
        return {
          state: {
            phase: "recording",
            starting: true,
            resumed: false,
            picking: "off",
            traceStarting: true,
            pages: atRecord(state.pages).pages,
            inputs: [],
            snapshotsAsked: 0,
            // A page holds what follows from Record on, until its first
            // input has a "before".
            gates: freshGates(state.pages),
            reportedOnly: 0,
          },
          todo: [
            ...atRecord(state.pages).todo,
            // Reports first: a click held before Playwright listens would
            // be passed on without ever being reported. The pages are asked
            // to hold inputs back when Playwright reports, and Record is
            // answered when they do: "applied" means that a click is now
            // recorded.
            //
            // The recording's one trace starts here, at the first Record:
            // Continue goes on in the trace that is running. Playwright
            // is asked to report when the trace is started: from then on
            // a snapshot can be marked in it.
            { kind: "browser", ask: { kind: "startTrace" } },
            { kind: "deferReply" },
          ],
        };
      break;
    case "recording":
      if (asked.type === "finish") return applied(wrapUp(state, "save"));
      if (asked.type === "stop") return applied(wrapUp(state, "pause"));
      if (asked.type === "clear") return applied(wrapUp(state, "clear"));
      if (asked.type === "assertVisibility" && !state.starting)
        return assertVisibility(state);
      if (asked.type === "leaveAssertVisibility" && state.picking !== "off")
        return {
          state: { ...state, picking: "off" },
          todo: [
            ...(state.picking === "waiting" ? [] : [pickRequest(false)]),
            reply("applied"),
          ],
        };
      break;
    case "paused":
      // It starts as Record does, into the timeline that is there.
      if (asked.type === "continue") {
        const continued = continueVisits(state.pages);
        return {
          state: {
            phase: "recording",
            starting: true,
            resumed: true,
            picking: "off",
            traceStarting: false,
            pages: continued.pages,
            inputs: [],
            snapshotsAsked: state.snapshotsAsked,
            // As at Record: the page may have changed while paused. What
            // it changed then is not the recording's: each page's next
            // snapshot is where recording resumes.
            gates: freshGates(continued.pages).map((gate) => ({
              ...gate,
              resumes: true,
            })),
            reportedOnly: 0,
          },
          todo: [
            ...continued.todo,
            { kind: "browser", ask: { kind: "reportInteractions", on: true } },
            { kind: "deferReply" },
          ],
        };
      }
      // Nothing is under way while paused: there is nothing to wrap up, and
      // no last snapshot to take, which would show what the pause changed.
      if (asked.type === "clear")
        return {
          state: {
            phase: "wrappingUp",
            pages: state.pages,
            inputs: [],
            snapshotsAsked: state.snapshotsAsked,
            gates: [],
            reportedOnly: 0,
            gateOff: true,
            finals: [],
            then: "clear",
            switchingOff: true,
            traceStarting: false,
            discardingTrace: true,
          },
          // It is over, and everything is thrown away, when the trace is
          // gone: until then Record is ignored.
          todo: [discardTrace, reply("applied")],
        };
      // Answered first: the worker comes back from a save only when the
      // package is written.
      if (asked.type === "finish") return save(state, [reply("applied")]);
      // The only time an entry may be left out or put back: nothing is under
      // way, and Continue and Finish keep the decision with the timeline.
      if (asked.type === "discard" || asked.type === "restore")
        return {
          state,
          todo: [
            {
              kind: "timeline",
              add: { kind: asked.type, entry: asked.entry },
            },
            reply("applied"),
          ],
        };
      break;
  }
  // A command that does not apply now changes nothing: it is never kept for
  // later, and never read as the opposite one.
  return { state, todo: [reply("ignored")] };
}

/**
 * An end from outside. With nothing recorded, the recorder ends "empty"; a
 * recording is wrapped up and saved, and a paused one is saved as it is. A
 * wrap-up under way goes on, and now ends the recorder: one that would have
 * paused saves, and one that would have cleared ends "empty". A save under
 * way goes on: a second end joins it.
 */
function endFromOutside(state: LifecycleState): Step {
  switch (state.phase) {
    case "notRecording": {
      const outcome: RecordingOutcome = { kind: "empty" };
      return {
        state: { phase: "ended", pages: state.pages, outcome },
        todo: [{ kind: "end", outcome }],
      };
    }
    case "recording":
      return wrapUp(state, "save");
    case "wrappingUp":
      return stay({
        ...state,
        then:
          state.then === "pause"
            ? "save"
            : state.then === "clear"
              ? "clearAndEnd"
              : state.then,
      });
    case "paused":
      return save(state, []);
    default:
      return stay(state);
  }
}

/**
 * Starts the wrap-up that ends a stretch of recording. It is over when every
 * page has confirmed that it holds no input back, every held input has been
 * passed on and has its "after", a last snapshot of every page is in, and
 * Playwright's report for every input is in; or when the time limit passes.
 * Until then the recorder records: a click a page still holds back is
 * recorded like any other.
 */
function wrapUp(
  state: Extract<LifecycleState, { phase: "recording" }>,
  then: AfterWrapUp
): Step {
  return proceed(
    {
      phase: "wrappingUp",
      pages: state.pages,
      inputs: state.inputs,
      snapshotsAsked: state.snapshotsAsked,
      gates: state.gates,
      reportedOnly: state.reportedOnly,
      gateOff: false,
      finals: null,
      then,
      switchingOff: false,
      traceStarting: state.traceStarting,
      discardingTrace: false,
    },
    [
      // Assert visibility is never left on: picking would swallow a click.
      ...(state.picking === "asked" || state.picking === "on"
        ? [pickRequest(false)]
        : []),
      ...answerRecord(state),
      { kind: "browser", ask: { kind: "holdInputs", on: false } },
      { kind: "startTimeLimit", ms: WRAP_UP_LIMIT_MS },
    ]
  );
}

/** The answer to a Record that still waits for the pages: recording did
 * start, and whatever ends it must not leave Record unanswered. */
function answerRecord(state: LifecycleState): ToDo[] {
  return state.phase === "recording" && state.starting
    ? [{ kind: "replyDeferred", result: "applied" }]
    : [];
}

/** The recorded stretch is over for good: the trace is stopped and kept, and
 * the package is written when it is, or when that has taken too long: the
 * save waits on no browser for ever. */
function save(state: LifecycleState, todo: readonly ToDo[]): Step {
  return {
    state: { phase: "saving", pages: state.pages, stoppingTrace: true },
    todo: [
      ...todo,
      {
        kind: "browser",
        ask: { kind: "stopTrace", keep: true },
        within: TRACE_STOP_LIMIT_MS,
      },
    ],
  };
}

/** The trace is stopped, or could not be: the package is written, with it
 * when there is one. */
function writePackage(
  state: LifecycleState,
  trace: RecordingTrace | null
): Step {
  if (state.phase !== "saving" || !state.stoppingTrace) return stay(state);
  return {
    state: { ...state, stoppingTrace: false },
    todo: [trace ? { kind: "save", trace } : { kind: "save" }],
  };
}

/** The trace of a recording that is thrown away is gone, or could not be
 * stopped and nothing better can be had: the recording is thrown away, and
 * what the wrap-up led to is next. */
function traceGone(state: LifecycleState): Step {
  if (state.phase !== "wrappingUp" || !state.discardingTrace)
    return stay(state);
  const { pages } = state;
  if (state.then === "clearAndEnd") {
    const outcome: RecordingOutcome = { kind: "empty" };
    return {
      state: { phase: "ended", pages, outcome },
      todo: [{ kind: "clear" }, { kind: "end", outcome }],
    };
  }
  return {
    state: { phase: "notRecording", pages },
    todo: [{ kind: "clear" }],
  };
}

/** The trace of a recording that is thrown away goes with it. The recording
 * is over when it is gone, or when that has taken too long. */
const discardTrace: ToDo = {
  kind: "browser",
  ask: { kind: "stopTrace", keep: false },
  within: TRACE_STOP_LIMIT_MS,
};

// Visits.

/** Where a page opened by the page before it starts, before it goes anywhere. */
const BLANK = "about:blank";

/**
 * A Visit of a page at an address, while recording. Whether the address
 * starts a new Visit is core's rule, which the timeline follows: a change of
 * only the part after `?` or `#` stays in the Visit.
 */
const visitOf = (page: string, url: string, cause: VisitCause): ToDo => ({
  kind: "timeline",
  add: { kind: "visit", page, url, cause },
});

const causeOf = (page: Page): VisitCause =>
  page.since === "opened"
    ? "openPage"
    : page.since === "blankAtRecord"
      ? "initial"
      : "navigate";

/**
 * Record starts a Visit for each page at an address, the first one
 * "initial". A page that is still blank gets its Visit at its first real
 * address, as a page that opens blank while recording does.
 */
function atRecord(pages: readonly Page[]) {
  const first = pages.find((page) => page.url !== BLANK);
  return {
    pages: pages.map((page, index): Page =>
      page.url !== BLANK
        ? visited(page)
        : {
            ...visited(page),
            since: !first && index === 0 ? "blankAtRecord" : "opened",
          }
    ),
    todo: pages
      .filter((page) => page.url !== BLANK)
      .map((page) =>
        visitOf(page.id, page.url, page === first ? "initial" : "openPage")
      ),
  };
}

/** The page, with a Visit at its address. */
const visited = ({ id, url }: Page): Page => ({ id, url });

/** Continue starts a Visit for each page that went elsewhere, or opened,
 * while paused: what it does next is done there. */
function continueVisits(pages: readonly Page[]) {
  const starts = (page: Page) => page.since !== undefined && page.url !== BLANK;
  return {
    pages: pages.map((page) => (starts(page) ? visited(page) : page)),
    todo: pages
      .filter(starts)
      .map((page) => visitOf(page.id, page.url, causeOf(page))),
  };
}

/** The state without a page that closed. An input held for it that has not
 * reached it is dropped; one that has keeps its "before" only. */
function withoutPage(state: LifecycleState, page: string): LifecycleState {
  const pages = state.pages.filter((open) => open.id !== page);
  if (!isActive(state)) return { ...state, pages };
  const inputs = state.inputs.flatMap((input): Input[] => {
    if (input.page !== page) return [input];
    if (input.passedOnAt === null) return [];
    return [{ ...input, stage: "settled", asked: null }];
  });
  const gates = state.gates.filter((gate) => gate.page !== page);
  return state.phase === "recording"
    ? { ...state, pages, inputs, gates }
    : {
        ...state,
        pages,
        inputs,
        gates,
        finals: state.finals?.filter((final) => final.page !== page) ?? null,
      };
}

/** A recording being changed within one step. */
type Draft = {
  inputs: readonly Input[];
  snapshotsAsked: number;
  gates: readonly PageGate[];
  reportedOnly: number;
  readonly todo: ToDo[];
};

function changeGate(draft: Draft, page: string, patch: Partial<PageGate>) {
  const known = draft.gates.some((gate) => gate.page === page);
  draft.gates = known
    ? draft.gates.map((gate) =>
        gate.page === page ? { ...gate, ...patch } : gate
      )
    : [
        ...draft.gates,
        { page, holding: false, upTo: null, latest: null, ...patch },
      ];
}

const gateOf = (draft: Draft, page: string) =>
  draft.gates.find((gate) => gate.page === page);

function change(draft: Draft, id: string, patch: Partial<Input>) {
  draft.inputs = draft.inputs.map((input) =>
    input.id === id ? { ...input, ...patch } : input
  );
}

/** Asks for a snapshot of a page and says which one it will be. */
function askSnapshot(draft: Draft, page: string): string {
  const snapshot = `snapshot_${++draft.snapshotsAsked}`;
  draft.todo.push({
    kind: "browser",
    ask: { kind: "takeSnapshot", snapshot, page },
  });
  return snapshot;
}

/** One snapshot between two inputs of a page: the earlier one's "after" and
 * the later one's "before". The earlier input gets no further wait. */
function askSharedSnapshot(draft: Draft, earlier: Input, later: Input) {
  const asked = askSnapshot(draft, earlier.page);
  change(draft, earlier.id, { stage: "takingAfter", asked });
  change(draft, later.id, { stage: "takingBefore", asked });
}

/** The held input of a page that is under way: the oldest without its
 * "after". An input known from its report only goes its own way. */
const underWay = (draft: Draft, page: string) =>
  draft.inputs.find(
    (input) =>
      input.page === page &&
      input.held.kind !== "reported" &&
      input.stage !== "settled"
  );

/** What the browser tells about an input while a recording is under way. */
function during(state: Active, happening: BrowserSignal): Step {
  const draft: Draft = {
    inputs: state.inputs,
    snapshotsAsked: state.snapshotsAsked,
    gates: state.gates,
    reportedOnly: state.reportedOnly,
    todo: [],
  };
  let next = state;
  switch (happening.kind) {
    case "traceStarted":
      if (state.traceStarting) {
        next = { ...state, traceStarting: false };
        // Playwright reports from the trace on; a wrap-up that began
        // meanwhile has no more reports to ask for.
        if (state.phase === "recording")
          draft.todo.push({
            kind: "browser",
            ask: { kind: "reportInteractions", on: true },
          });
      }
      break;
    case "reportingInteractions":
      if (state.phase === "recording" && state.starting && happening.on)
        draft.todo.push({
          kind: "browser",
          ask: { kind: "holdInputs", on: true },
        });
      if (state.phase === "wrappingUp" && state.switchingOff && !happening.on)
        // Nothing newer can be reported now: an input known from its report
        // only is written, and the wrap-up is over. One that is not
        // finished is finished first; then Playwright's recorder is
        // switched off once more.
        return proceed({ ...state, switchingOff: false }, [], true);
      break;
    case "inputsHeld":
      if (state.phase === "wrappingUp" && !happening.on)
        next = { ...state, gateOff: true };
      if (state.phase === "recording" && state.starting && happening.on) {
        next = { ...state, starting: false };
        draft.todo.push({ kind: "replyDeferred", result: "applied" });
        // After a pause every page is read as it stands now that its
        // inputs are held back: from here on, what changes is recorded.
        if (state.resumed)
          for (const page of state.pages)
            changeGate(draft, page.id, {
              resuming: askSnapshot(draft, page.id),
            });
      }
      break;
    case "inputHeld": {
      const earlier = underWay(draft, happening.page);
      const held: Input = {
        id: happening.input,
        page: happening.page,
        held: happening.held ?? { kind: "click", count: 1 },
        joins: null,
        unreported: false,
        revised: false,
        stage: "waiting",
        asked: null,
        before: null,
        after: null,
        passedOnAt: null,
        report: null,
      };
      draft.inputs = [...draft.inputs, held];
      // The page holds everything after it now, by itself.
      changeGate(draft, happening.page, { holding: true, upTo: held.id });
      // A newer snapshot closes the previous Interaction.
      if (earlier?.stage === "settling")
        askSharedSnapshot(draft, earlier, held);
      break;
    }
    case "snapshotTaken": {
      const { snapshot } = happening;
      const owners = draft.inputs.filter(
        (input) => input.asked === snapshot.id
      );
      const finals = state.phase === "wrappingUp" ? state.finals : null;
      const isFinal = finals?.some((final) => final.snapshot === snapshot.id);
      const gate = gateOf(draft, snapshot.page);
      const resuming = gate?.resuming === snapshot.id;
      // A snapshot nobody waits for is of a page or an input that is gone.
      if (owners.length === 0 && !isFinal && !resuming) break;
      draft.todo.push({
        kind: "timeline",
        add: gate?.resumes
          ? { kind: "snapshot", snapshot, resumes: true }
          : { kind: "snapshot", snapshot },
      });
      changeGate(draft, snapshot.page, {
        latest: { id: snapshot.id, at: snapshot.at },
        ...(gate?.resumes ? { resumes: false } : {}),
        ...(resuming ? { resuming: null } : {}),
      });
      for (const owner of owners) {
        if (owner.stage === "takingAfter" && owner.revised) {
          // Revised meanwhile: the page is given time again.
          change(draft, owner.id, {
            stage: "settling",
            after: snapshot.id,
            asked: null,
            revised: false,
          });
          draft.todo.push(settleAfter(owner));
        } else if (owner.stage === "takingAfter") {
          change(draft, owner.id, {
            stage: "settled",
            after: snapshot.id,
            asked: null,
          });
        } else if (owner.held.kind === "asserted") {
          // One snapshot, as the page stood when the element was picked.
          change(draft, owner.id, {
            stage: "settled",
            before: snapshot.id,
            after: snapshot.id,
            passedOnAt: snapshot.at,
            asked: null,
          });
        } else if (owner.held.kind === "reported") {
          // It has a snapshot to start from: now the page is given time.
          change(draft, owner.id, {
            stage: "settling",
            before: snapshot.id,
            passedOnAt: snapshot.at,
            asked: null,
          });
          draft.todo.push(settleAfter(owner));
        } else {
          // Its "before" is in: now it may reach the page.
          change(draft, owner.id, {
            stage: "passingOn",
            before: snapshot.id,
            asked: null,
          });
          draft.todo.push({
            kind: "browser",
            ask: { kind: "passOn", input: owner.id },
          });
        }
      }
      if (state.phase === "wrappingUp" && finals)
        next = {
          ...state,
          finals: finals.filter((final) => final.snapshot !== snapshot.id),
        };
      break;
    }
    case "inputPassedOn": {
      const input = draft.inputs.find(
        (held) => held.id === happening.input && held.stage === "passingOn"
      );
      if (!input) break;
      change(draft, input.id, { passedOnAt: happening.at });
      // Typing has no "after": what it changed is the typing's report's.
      if (input.held.kind === "typing") {
        change(draft, input.id, { stage: "settled" });
        break;
      }
      const later = draft.inputs.find(
        (held) => held.page === input.page && held.stage === "waiting"
      );
      // While an input is held, the page gets no time to settle: the next
      // input's "before" is this one's "after".
      if (later) {
        askSharedSnapshot(draft, input, later);
      } else {
        change(draft, input.id, { stage: "settling" });
        draft.todo.push({
          kind: "browser",
          ask: { kind: "waitForSettled", page: input.page, input: input.id },
        });
      }
      break;
    }
    case "pageSettled": {
      const input = draft.inputs.find(
        (held) => held.id === happening.input && held.stage === "settling"
      );
      // A wait that was cut short ends too: nothing waits for it any more.
      if (!input) break;
      change(draft, input.id, {
        stage: "takingAfter",
        asked: askSnapshot(draft, input.page),
      });
      break;
    }
    case "interactionRevised": {
      const open = draft.inputs.findLast(
        (input) =>
          input.page === happening.page && input.held.kind === "reported"
      );
      if (!open || open.report?.type !== happening.report.type) break;
      change(draft, open.id, { report: happening.report });
      if (open.stage === "takingAfter")
        change(draft, open.id, { revised: true });
      if (open.stage === "settled") {
        change(draft, open.id, { stage: "settling" });
        draft.todo.push(settleAfter(open));
      }
      break;
    }
    case "inputGone":
      // Never passed on to the document that came after it.
      draft.inputs = draft.inputs.filter(
        (held) => held.id !== happening.input || held.passedOnAt !== null
      );
      break;
    case "interactionReported": {
      if (happening.report.type === ASSERTED) {
        asserted(draft, happening.page, happening.report);
        break;
      }
      const kind = heldKindOf(happening.report);
      if (kind === null && REPORTED_ONLY.has(happening.report.type)) {
        knownFromReport(draft, happening.page, happening.report);
        break;
      }
      if (kind === null) break;
      // Reports come in the order of the inputs: this one belongs to the
      // oldest input of its page and its kind that has none, if that input
      // is on its way.
      const input = draft.inputs.find(
        (held) =>
          held.page === happening.page &&
          held.held.kind === kind &&
          held.report === null &&
          held.joins === null
      );
      if (!input) {
        // A click or a key made while the recorder wraps up, once the pages
        // no longer hold inputs back: recording ends when "Paused" shows,
        // so it is recorded from Playwright's report alone. A click of
        // count zero is a key's or a label's, recorded with that key.
        if (
          state.phase === "wrappingUp" &&
          happening.report.values["clickCount"] !== 0 &&
          state.pages.some((page) => page.id === happening.page)
        )
          knownFromReport(draft, happening.page, happening.report);
        break;
      }
      if (input.stage === "waiting" || input.stage === "takingBefore") break;
      // A key pressed with nothing focused has no target, whatever element
      // Playwright names for it.
      const report =
        input.held.kind === "press" && input.held.nothingFocused
          ? { ...happening.report, target: null }
          : happening.report;
      change(draft, input.id, { report });
      coverFollowingClicks(draft, input, report);
      giveUpEarlier(
        draft,
        input.page,
        draft.inputs.findIndex((held) => held.id === input.id)
      );
      break;
    }
  }
  return proceed({ ...next, ...settle(draft) }, draft.todo);
}

/**
 * An input known from its report only starts from its page's latest
 * snapshot, or takes one when there is none. It ends where the next held
 * input of its page starts; with none, once the page is settled and no
 * held input of the page is under way.
 */
function carryOnReported(draft: Draft, id: string) {
  const index = draft.inputs.findIndex((input) => input.id === id);
  const input = draft.inputs[index]!;
  if (input.held.kind !== "reported") return;
  if (input.stage !== "waiting" && input.stage !== "settling") return;
  if (!input.before) {
    if (input.stage !== "waiting") return;
    // A held input that reached the page before it has no "after" yet: it
    // starts from that.
    const reached = draft.inputs
      .slice(0, index)
      .some(
        (earlier) =>
          earlier.page === input.page &&
          earlier.held.kind !== "reported" &&
          earlier.passedOnAt !== null &&
          earlier.stage !== "settled"
      );
    if (reached) return;
    // An earlier input known from its report only that has no "after" yet
    // ends where this one starts: one snapshot is both, as between two held
    // inputs. Starting from the page's latest snapshot instead would give
    // the two one "before", and the earlier one an "after" that is later
    // than this one's "before". An assertion's one snapshot is waited for
    // in the same way.
    const open = draft.inputs
      .slice(0, index)
      .findLast(
        (earlier) =>
          earlier.page === input.page &&
          (earlier.held.kind === "reported" ||
            earlier.held.kind === "asserted") &&
          earlier.stage !== "settled"
      );
    if (open?.stage === "settling") {
      askSharedSnapshot(draft, open, input);
      return;
    }
    if (open?.stage === "takingAfter") {
      // The snapshot under way is its last: what revised it meanwhile gets
      // no further wait.
      change(draft, open.id, { revised: false });
      change(draft, id, { stage: "takingBefore", asked: open.asked });
      return;
    }
    // It has no start of its own yet: this one waits for that.
    if (open) return;
    const latest = gateOf(draft, input.page)?.latest;
    if (!latest) {
      change(draft, id, {
        stage: "takingBefore",
        asked: askSnapshot(draft, input.page),
      });
      return;
    }
    change(draft, id, { before: latest.id, passedOnAt: latest.at });
    return carryOnReported(draft, id);
  }
  const next = draft.inputs
    .slice(index + 1)
    .find(
      (later) =>
        later.page === input.page &&
        later.held.kind !== "typing" &&
        later.held.kind !== "reported"
    );
  if (next?.before) {
    change(draft, id, { stage: "settled", after: next.before });
    return;
  }
  if (next?.stage === "takingBefore") {
    change(draft, id, { stage: "takingAfter", asked: next.asked });
    return;
  }
  if (next || input.stage === "settling" || underWay(draft, input.page)) return;
  change(draft, id, { stage: "settling" });
  draft.todo.push(settleAfter(input));
}

/** An input known from Playwright's report only. It happened before every
 * input of its page that has not reached the page yet. */
function knownFromReport(
  draft: Draft,
  page: string,
  report: InteractionReport
) {
  let place = draft.inputs.findIndex(
    (input) =>
      input.page === page &&
      // An assertion was reported before it: it came first.
      input.held.kind !== "asserted" &&
      (input.stage === "waiting" || input.stage === "takingBefore")
  );
  if (place < 0) place = draft.inputs.length;
  giveUpEarlier(draft, page, place);
  draft.inputs = [
    ...draft.inputs.slice(0, place),
    {
      id: `reported_${++draft.reportedOnly}`,
      page,
      held: { kind: "reported" },
      revised: false,
      joins: null,
      unreported: false,
      stage: "waiting",
      asked: null,
      // Its start is found as it carries on.
      before: null,
      after: null,
      passedOnAt: null,
      report,
    },
    ...draft.inputs.slice(place),
  ];
}

/** Playwright reports in order: the inputs of a page held before the
 * `index`th that have no report yet will get none. */
function giveUpEarlier(draft: Draft, page: string, index: number) {
  for (const earlier of draft.inputs.slice(0, index))
    if (
      earlier.page === page &&
      earlier.report === null &&
      earlier.joins === null
    )
      change(draft, earlier.id, { unreported: true });
}

const settleAfter = (input: Input): ToDo => ({
  kind: "browser",
  ask: { kind: "waitForSettled", page: input.page, input: input.id },
});

/**
 * Lets inputs reach a page that holds what follows, once nothing of it is
 * under way and it has a snapshot to start from. A page that no longer
 * holds inputs back lets them through by itself once nothing it held
 * waits to be passed on.
 */
function letThrough(draft: Draft) {
  for (const gate of draft.gates) {
    const held = draft.inputs.some(
      (input) =>
        input.page === gate.page &&
        input.held.kind !== "reported" &&
        input.stage !== "settled"
    );
    if (!gate.holding || held) continue;
    if (!gate.latest) continue;
    changeGate(draft, gate.page, { holding: false });
    draft.todo.push({
      kind: "browser",
      ask: { kind: "letInputsThrough", page: gate.page, upTo: gate.upTo },
    });
  }
}

/**
 * A click reported with a count above one stands for the clicks before it
 * too: Playwright reports a double click once, with a count of two. The
 * clicks it covers are the ones held right after the reported one, counting
 * up to the reported count.
 */
function coverFollowingClicks(
  draft: Draft,
  head: Input,
  report: InteractionReport
) {
  const count = report.values["clickCount"];
  if (head.held.kind !== "click" || typeof count !== "number") return;
  let last = head.held.count;
  for (const input of draft.inputs.slice(
    draft.inputs.findIndex((input) => input.id === head.id) + 1
  )) {
    if (input.page !== head.page) continue;
    if (
      input.report !== null ||
      input.joins !== null ||
      input.held.kind !== "click" ||
      input.held.count !== last + 1 ||
      input.held.count > count
    )
      break;
    change(draft, input.id, { joins: head.id });
    last = input.held.count;
  }
}

const settle = (draft: Draft): Flow => ({
  inputs: draft.inputs,
  snapshotsAsked: draft.snapshotsAsked,
  gates: draft.gates,
  reportedOnly: draft.reportedOnly,
});

/** What follows from a recording's state as it now stands, whatever
 * happened: the next input of a free page starts, an input with everything
 * it needs is written down, and a wrap-up that has all it waited for saves. */
function proceed(
  state: Active,
  done: readonly ToDo[],
  /** Playwright's recorder was just confirmed off. */
  reportsOff = false
): Step {
  const draft: Draft = {
    // An input whose "before" could not be taken is not recorded. It was
    // kept until its report came, so that no later input took the report
    // for its own: now it is let go.
    inputs: state.inputs.filter(
      (input) => input.stage !== "settled" || !input.report || input.before
    ),
    snapshotsAsked: state.snapshotsAsked,
    gates: state.gates,
    reportedOnly: state.reportedOnly,
    todo: [...done],
  };
  for (const page of new Set(draft.inputs.map((input) => input.page))) {
    const next = underWay(draft, page);
    if (next?.stage !== "waiting") continue;
    // Typing needs no "before" once the page has a snapshot to start from.
    if (next.held.kind === "typing" && gateOf(draft, page)?.latest) {
      change(draft, next.id, { stage: "passingOn" });
      draft.todo.push({
        kind: "browser",
        ask: { kind: "passOn", input: next.id },
      });
    } else
      change(draft, next.id, {
        stage: "takingBefore",
        asked: askSnapshot(draft, page),
      });
  }
  for (const input of draft.inputs) carryOnReported(draft, input.id);
  // Typing that reached its page is done with.
  draft.inputs = draft.inputs.filter(
    (input) => input.held.kind !== "typing" || input.stage !== "settled"
  );
  // While the recorder wraps up, an input known from its report only can
  // still be revised, as typing goes on until "Paused" shows: it is written
  // at the last, when nothing newer can be reported.
  const atTheLast = (finals: readonly unknown[] | null) =>
    state.phase === "wrappingUp" &&
    finals?.length === 0 &&
    (reportsOff || endsRecorder(state.then));
  writeDown(draft, state.phase === "wrappingUp" && atTheLast(state.finals));
  if (state.phase === "recording") letThrough(draft);
  if (state.phase === "recording")
    return {
      state: { ...state, ...settle(draft), picking: pickNow(state, draft) },
      todo: draft.todo,
    };

  let finals = state.finals;
  if (
    state.gateOff &&
    finals === null &&
    // A snapshot is marked in the trace, which a Finish pressed at once may
    // not have started yet.
    !state.traceStarting &&
    draft.inputs.every((input) => input.stage === "settled")
  )
    // What changed after the last Interaction is picked up once, here.
    finals = state.pages.map((page) => ({
      page: page.id,
      snapshot: askSnapshot(draft, page.id),
    }));
  // The last snapshots may be in just now, as when no page is left.
  writeDown(draft, atTheLast(finals));
  const next = { ...state, ...settle(draft), finals };
  if (
    finals?.length !== 0 ||
    draft.inputs.some((input) => !awaitsTheLast(input)) ||
    state.switchingOff ||
    state.discardingTrace
  )
    return { state: next, todo: draft.todo };
  // A recorder that ends is let go with its browser. One that lives on has
  // Playwright's recorder switched off first: it is not recording any more.
  if (draft.inputs.length === 0 && (reportsOff || endsRecorder(state.then)))
    return wrappedUp(next, draft.todo);
  return {
    state: { ...next, switchingOff: true },
    todo: [
      ...draft.todo,
      { kind: "browser", ask: { kind: "reportInteractions", on: false } },
    ],
  };
}

/** Whether a wrap-up ends the recorder: Playwright's recorder is then let
 * go with the browser, and never switched off. */
const endsRecorder = (then: AfterWrapUp) =>
  then === "save" || then === "clearAndEnd";

/** An input known from its report only that has all it needs, and waits to
 * be written at the last. */
const awaitsTheLast = (input: Input) =>
  input.held.kind === "reported" &&
  input.stage === "settled" &&
  input.report !== null &&
  input.before !== null;

/**
 * Writes down every input that has all it needs, in the order of the
 * inputs. `last`: nothing newer can happen any more, so an input known from
 * its report only is written too.
 */
function writeDown(draft: Draft, last: boolean) {
  for (const input of draft.inputs) {
    if (input.stage === "settled" && input.unreported) {
      draft.inputs = draft.inputs.filter((held) => held.id !== input.id);
      continue;
    }
    if (input.stage !== "settled" || !input.report || !input.before) continue;
    // An input known from its report only may still be revised: it is
    // written once something newer happened on its page, or at the last.
    const reportedOnly = input.held.kind === "reported";
    if (
      reportedOnly &&
      !last &&
      !draft.inputs
        .slice(draft.inputs.findIndex((held) => held.id === input.id) + 1)
        .some(
          (later) => later.page === input.page && later.held.kind !== "typing"
        )
    )
      continue;
    // Entries keep the order of the inputs: an earlier input of the page
    // that is not written down yet goes first.
    const earlier = draft.inputs.slice(
      0,
      draft.inputs.findIndex((held) => held.id === input.id)
    );
    if (earlier.some((held) => held.page === input.page && !held.joins))
      continue;
    const covered = draft.inputs.filter((held) => held.joins === input.id);
    if (covered.some((held) => held.stage !== "settled")) continue;
    const after = covered.at(-1)?.after ?? input.after;
    draft.todo.push({
      kind: "timeline",
      add: {
        kind: "interaction",
        interaction: {
          page: input.page,
          report: input.report,
          before: input.before,
          after: covered.length > 0 ? after : input.after,
          at: input.passedOnAt ?? 0,
          ...(reportedOnly ? { beforeFromReport: true } : {}),
        },
      },
    });
    draft.inputs = draft.inputs.filter(
      (held) => held.id !== input.id && held.joins !== input.id
    );
  }
}

/** What a wrap-up that is over leads to. */
function wrappedUp(
  state: Extract<LifecycleState, { phase: "wrappingUp" }>,
  todo: readonly ToDo[]
): Step {
  const { pages } = state;
  switch (state.then) {
    case "save":
      return save(state, todo);
    case "pause":
      return {
        state: { phase: "paused", pages, snapshotsAsked: state.snapshotsAsked },
        todo,
      };
    case "clear":
    case "clearAndEnd":
      // Thrown away once the trace is gone, not before: the recorder takes
      // no Record meanwhile. Whatever else tells that the wrap-up is over
      // finds the trace already asked to stop.
      if (state.discardingTrace) return { state, todo };
      return {
        state: { ...state, discardingTrace: true },
        todo: [...todo, discardTrace],
      };
  }
}

/**
 * The wrap-up's time limit has passed: whatever is still owed is left out
 * of the recording, and what is complete is written. A click that is still
 * held back is the page's all the same, and is passed on. Nothing is waited
 * for any more.
 */
function giveUp(state: Extract<LifecycleState, { phase: "wrappingUp" }>): Step {
  // What is owed is only the trace, and it has its own answer.
  if (state.discardingTrace) return stay(state);
  // What has all it needs is written all the same; what is owed something
  // is in nobody's way any more.
  const draft: Draft = {
    inputs: state.inputs.filter(
      (input) =>
        input.stage === "settled" &&
        (input.report !== null || input.joins !== null)
    ),
    snapshotsAsked: state.snapshotsAsked,
    gates: state.gates,
    reportedOnly: state.reportedOnly,
    todo: [],
  };
  writeDown(draft, true);
  const todo = [...draft.todo, ...release(state.inputs)];
  const livesOn = state.then === "pause" || state.then === "clear";
  if (livesOn && !state.switchingOff)
    todo.push({
      kind: "browser",
      ask: { kind: "reportInteractions", on: false },
    });
  return wrappedUp(state, todo);
}

/** Lets every input that is still held back reach its page. */
function release(inputs: readonly Input[]): ToDo[] {
  return inputs
    .filter(
      (input) => input.stage === "waiting" || input.stage === "takingBefore"
    )
    .map((input) => ({
      kind: "browser",
      ask: { kind: "passOn", input: input.id },
    }));
}

/**
 * The browser could not carry out a request, and no other answer to it
 * comes. Nothing may wait for one: each request has what follows when it
 * breaks.
 */
function failed(
  state: LifecycleState,
  request: BrowserRequest,
  reason: string
): Step {
  switch (request.kind) {
    case "reportInteractions":
    case "holdInputs":
      if (request.on) return cannotStart(state, request, reason);
      // Switching off cannot be confirmed, and nothing better can be had:
      // it counts as done. A click a page holds back all the same is passed
      // on when it tells of it, and a report that comes all the same is
      // ignored.
      return step(
        state,
        request.kind === "holdInputs"
          ? { kind: "inputsHeld", on: false }
          : { kind: "reportingInteractions", on: false }
      );
    case "waitForSettled":
      // The wait is over: the page is read as it is.
      return step(state, {
        kind: "pageSettled",
        page: request.page,
        input: request.input,
      });
    case "takeSnapshot":
    case "passOn":
      return isActive(state) ? unanswered(state, request) : stay(state);
    case "stopTrace":
      // A trace that cannot be had is no reason to lose the recording: the
      // package is written without one. A trace that is thrown away anyway
      // is not missed, and its recording is over all the same.
      return request.keep ? writePackage(state, null) : traceGone(state);
    case "startTrace":
      // Without its trace the recording would have no snapshots to open: it
      // does not start. A wrap-up that began meanwhile goes on without it:
      // it waited for the trace only to mark snapshots in it.
      return state.phase === "wrappingUp"
        ? step(state, { kind: "traceStarted" })
        : cannotStart(state, request, reason);
    // Every kind of input.
    case "letInputsThrough":
      // The page goes on holding what follows: each key it holds is told
      // of, passed on, and lets the page through once more.
      return stay(state);
    // Assert visibility.
    case "pick":
      // Picking that cannot start is off; picking that cannot be left
      // counts as left, as switching Playwright's recorder off does.
      return request.on ? pickingChanged(state, false, false) : stay(state);
    // Highlight.
    case "highlight":
      // Nothing is drawn: there is nothing to clear.
      return request.target
        ? answerHighlight(state, request.highlight, "notFound")
        : stay(state);
  }
}

/**
 * Recording cannot start: Playwright's recorder does not report, or the
 * pages do not hold inputs back. After Continue the recorder is paused
 * again, with what it recorded, and Continue is answered "ignored". After
 * Record there is nothing to go back to that could record: the recorder
 * ends "failed", and says why.
 */
function cannotStart(
  state: LifecycleState,
  request: Extract<
    BrowserRequest,
    { kind: "reportInteractions" | "holdInputs" | "startTrace" }
  >,
  reason: string
): Step {
  if (state.phase !== "recording" || !state.starting) return stay(state);
  const ignored: ToDo = { kind: "replyDeferred", result: "ignored" };
  if (!state.resumed) {
    const outcome: RecordingOutcome = {
      kind: "failed",
      reason: `Recording could not start. ${reason}`,
    };
    return {
      state: { phase: "ended", pages: state.pages, outcome },
      todo: [ignored, { kind: "end", outcome }],
    };
  }
  return {
    state: {
      phase: "paused",
      pages: state.pages,
      snapshotsAsked: state.snapshotsAsked,
    },
    todo: [
      ...release(state.inputs),
      // What Continue had switched on is switched off again.
      ...(request.kind === "holdInputs"
        ? ([
            { kind: "browser", ask: { kind: "holdInputs", on: false } },
            { kind: "browser", ask: { kind: "reportInteractions", on: false } },
          ] satisfies ToDo[])
        : []),
      ignored,
    ],
  };
}

/** A snapshot that could not be taken, or an input that could not be passed
 * on, while a recording is under way. */
function unanswered(
  state: Active,
  request: Extract<BrowserRequest, { kind: "takeSnapshot" | "passOn" }>
): Step {
  const draft: Draft = {
    inputs: state.inputs,
    snapshotsAsked: state.snapshotsAsked,
    gates: state.gates,
    reportedOnly: state.reportedOnly,
    todo: [],
  };
  let next = state;
  if (request.kind === "passOn") {
    // It cannot reach its page: it is dropped, as one whose page is gone.
    draft.inputs = draft.inputs.filter(
      (input) => input.id !== request.input || input.stage !== "passingOn"
    );
  } else {
    for (const owner of draft.inputs.filter(
      (input) => input.asked === request.snapshot
    )) {
      if (owner.stage === "takingAfter") {
        // It keeps its "before" only, as when its page is gone.
        change(draft, owner.id, { stage: "settled", asked: null });
      } else {
        // Without a "before" it cannot be recorded. It is the page's all
        // the same: it is passed on, and goes its way like any other, so
        // that the inputs behind it keep their order.
        change(draft, owner.id, { stage: "passingOn", asked: null });
        draft.todo.push({
          kind: "browser",
          ask: { kind: "passOn", input: owner.id },
        });
      }
    }
    if (state.phase === "wrappingUp" && state.finals)
      next = {
        ...state,
        finals: state.finals.filter(
          (final) => final.snapshot !== request.snapshot
        ),
      };
  }
  return proceed({ ...next, ...settle(draft) }, draft.todo);
}

// Assert visibility.

/** Playwright's name for an assertion that an element is visible. */
const ASSERTED = "assertVisible";

const pickRequest = (on: boolean): ToDo => ({
  kind: "browser",
  ask: { kind: "pick", on },
});

/** Whether an input a page held back has not reached it yet: picking would
 * swallow it when it is passed on. */
const anyHeld = (inputs: readonly Input[]) =>
  inputs.some(
    (input) =>
      (input.held.kind === "click" ||
        input.held.kind === "press" ||
        input.held.kind === "typing") &&
      input.passedOnAt === null
  );

/** Assert visibility, while recording: it takes effect only when no input
 * is held back, and waits until then. */
function assertVisibility(
  state: Extract<LifecycleState, { phase: "recording" }>
): Step {
  const reply: ToDo = { kind: "reply", result: "ignored" };
  if (state.picking !== "off") return { state, todo: [reply] };
  const applied: ToDo = { kind: "reply", result: "applied" };
  if (anyHeld(state.inputs))
    return { state: { ...state, picking: "waiting" }, todo: [applied] };
  return {
    state: { ...state, picking: "asked" },
    todo: [pickRequest(true), applied],
  };
}

/** Assert visibility that waited is asked of Playwright once no input is
 * held back any more. */
function pickNow(
  state: Extract<LifecycleState, { phase: "recording" }>,
  draft: Draft
): Picking {
  if (state.picking !== "waiting" || anyHeld(draft.inputs))
    return state.picking;
  draft.todo.push(pickRequest(true));
  return "asked";
}

/**
 * Playwright's recorder entered its picking mode, or left it. Only a
 * recording picks: while it wraps up, picking is being left. Once picking
 * ends, the pages are told to hold inputs again: `tell` is false when the
 * request to pick is what broke.
 */
function pickingChanged(state: LifecycleState, on: boolean, tell = true): Step {
  if (state.phase !== "recording") return stay(state);
  if (on) return stay({ ...state, picking: "on" });
  if (state.picking === "off") return stay(state);
  return {
    state: { ...state, picking: "off" },
    todo: tell ? [pickRequest(false)] : [],
  };
}

/**
 * An assertion Playwright reported. It takes one snapshot, after every
 * input of its page that came before it: an Interaction that is still
 * settling gets the same snapshot as its "after", so that what changed
 * after the assertion is never the Interaction's.
 */
function asserted(draft: Draft, page: string, report: InteractionReport) {
  const earlier = underWay(draft, page);
  const assertion: Input = {
    id: `reported_${++draft.reportedOnly}`,
    page,
    held: { kind: "asserted" },
    joins: null,
    unreported: false,
    revised: false,
    stage: "waiting",
    asked: null,
    before: null,
    after: null,
    passedOnAt: null,
    report,
  };
  draft.inputs = [...draft.inputs, assertion];
  if (earlier?.stage === "settling")
    askSharedSnapshot(draft, earlier, assertion);
}

// Highlight.

/** Whether the recording can be reviewed now, and its entries highlighted:
 * while recording or paused. */
const reviewable = (state: LifecycleState) =>
  state.phase === "recording" || state.phase === "paused";

const drawHighlight = (n: number, target: HighlightTarget | null): ToDo => ({
  kind: "browser",
  ask: { kind: "highlight", highlight: n, target },
});

const keyOf = (n: number) => `highlight_${n}`;

/** A highlight, or Clear highlight: each replaces the highlight before it. */
function highlight(
  state: LifecycleState,
  asked: Extract<RecorderCommand, { type: "highlight" | "clearHighlight" }>
): Step {
  const n = (state.highlights ?? 0) + 1;
  const next = { ...state, highlights: n };
  if (asked.type === "clearHighlight")
    return {
      state: next,
      todo: [drawHighlight(n, null), { kind: "reply", result: "applied" }],
    };
  // The element is the timeline's to find, and then the browser's.
  return {
    state: next,
    todo: [
      { kind: "keepReply", key: keyOf(n) },
      { kind: "locate", entry: asked.entry, highlight: n },
    ],
  };
}

/** The timeline found the element of highlight `n`, or found none. */
function located(
  state: LifecycleState,
  n: number,
  target: HighlightTarget | null
): Step {
  if (n !== state.highlights || !reviewable(state))
    return answerHighlight(state, n, "ignored");
  if (!target)
    return {
      state,
      todo: [
        { kind: "replyKept", key: keyOf(n), result: "notFound" },
        drawHighlight(n, null),
      ],
    };
  return { state, todo: [drawHighlight(n, target)] };
}

/** Answers highlight `n`: one that a later one replaced is "ignored". */
function answerHighlight(
  state: LifecycleState,
  n: number,
  result: CommandResult
): Step {
  return {
    state,
    todo: [
      {
        kind: "replyKept",
        key: keyOf(n),
        result: n === state.highlights ? result : "ignored",
      },
    ],
  };
}
