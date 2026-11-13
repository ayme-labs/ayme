import type {
  CommandResult,
  RecorderCommand,
  RecorderPhase,
  RecordingOutcome,
} from "../../contract";
import type {
  InteractionReport,
  PageSnapshot,
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
  /** Playwright reports Interactions from now on. */
  | { readonly kind: "reportingInteractions" }
  /** Every page confirms that it holds inputs back, or that it no longer does. */
  | { readonly kind: "inputsHeld"; readonly on: boolean }
  /** A page held an input back: it has not reached the page yet. */
  | {
      readonly kind: "inputHeld";
      readonly input: string;
      readonly page: string;
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
    };

/**
 * One thing the engine asks of the recorded browser. The browser takes a
 * request and returns at once; what comes of it is told later, as a
 * `BrowserSignal`. Two requests that must follow each other are therefore
 * two steps: the second is asked when the first is answered.
 */
export type BrowserRequest =
  /** Have Playwright report Interactions from now on. Answered by
   * "reportingInteractions". */
  | { readonly kind: "reportInteractions" }
  /** Hold inputs back in every page, or stop doing so. Answered by
   * "inputsHeld" once every page has confirmed. */
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
  | { readonly kind: "brokeDown"; readonly reason: string };

/** One thing the worker carries out after a step, in the list's order. */
export type ToDo =
  /** Answer the command this step handled. */
  | { readonly kind: "reply"; readonly result: CommandResult }
  /** Keep the answer to the command this step handled for a later step. */
  | { readonly kind: "deferReply" }
  /** Give the answer that was kept. */
  | { readonly kind: "replyDeferred"; readonly result: CommandResult }
  | { readonly kind: "browser"; readonly ask: BrowserRequest }
  | { readonly kind: "timeline"; readonly add: TimelineAddition }
  /** Tell the lifecycle "timeLimitPassed" after this long. */
  | { readonly kind: "startTimeLimit"; readonly ms: number }
  /** Write the Recording Package, then tell the lifecycle "saved". */
  | { readonly kind: "save" }
  /** The recorder has ended: let the browser go and report the outcome. */
  | { readonly kind: "end"; readonly outcome: RecordingOutcome };

/**
 * How long a wrap-up may take. It is there for a report that never comes:
 * Playwright reports a click about half a second late, and a Settled Page
 * can take two seconds.
 */
export const WRAP_UP_LIMIT_MS = 5_000;

/** The reports a held click can lead to. */
const HELD_CLICK_REPORTS = new Set(["click", "check", "uncheck"]);

type Page = {
  readonly id: string;
  readonly url: string;
  /** Opened blank while recording: its Visit starts where it goes first. */
  readonly blank?: true;
};

/** One input the gate held back, until it is written down or dropped. */
type Input = {
  readonly id: string;
  readonly page: string;
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
};

export type LifecycleState = { readonly pages: readonly Page[] } & (
  | { readonly phase: "notRecording" }
  | ({
      readonly phase: "recording";
      /** Record is not answered yet: the pages do not all hold inputs back. */
      readonly starting: boolean;
    } & Flow)
  | ({
      readonly phase: "wrappingUp";
      /** Every page confirmed that it holds no input back any more. */
      readonly gateOff: boolean;
      /** The last snapshots still under way; null until they are asked for. */
      readonly finals: readonly { page: string; snapshot: string }[] | null;
    } & Flow)
  | { readonly phase: "saving" }
  | { readonly phase: "ended"; readonly outcome: RecordingOutcome }
);

type Active = Extract<LifecycleState, { phase: "recording" | "wrappingUp" }>;

export const initialState: LifecycleState = {
  phase: "notRecording",
  pages: [],
};

/** The phase a state shows outside the engine. */
export function shown(state: LifecycleState): RecorderPhase {
  return state.phase === "ended"
    ? { phase: "ended", outcome: state.outcome }
    : { phase: state.phase };
}

type Step = {
  readonly state: LifecycleState;
  readonly todo: readonly ToDo[];
};

const stay = (state: LifecycleState): Step => ({ state, todo: [] });
const isActive = (state: LifecycleState): state is Active =>
  state.phase === "recording" || state.phase === "wrappingUp";

export function step(state: LifecycleState, happening: Happening): Step {
  switch (happening.kind) {
    case "command":
      return command(state, happening.command);
    case "outsideEnd":
    case "browserGone":
      return endFromOutside(state);
    case "pageOpened": {
      const blank = isActive(state) && happening.url === BLANK;
      const opened = {
        ...state,
        pages: [
          ...state.pages,
          {
            id: happening.page,
            url: happening.url,
            ...(blank ? { blank: true as const } : {}),
          },
        ],
      };
      return isActive(opened) && !blank
        ? proceed(opened, [visitOf(happening.page, happening.url, "openPage")])
        : stay(opened);
    }
    case "pageNavigated": {
      const page = state.pages.find((open) => open.id === happening.page);
      const moved = {
        ...state,
        pages: state.pages.map((open) =>
          open === page ? { id: open.id, url: happening.url } : open
        ),
      };
      return isActive(moved)
        ? proceed(moved, [
            visitOf(
              happening.page,
              happening.url,
              page?.blank ? "openPage" : "navigate"
            ),
          ])
        : stay(moved);
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
    case "timeLimitPassed":
      // Whatever is still owed is left out.
      return state.phase === "wrappingUp" ? save(state, []) : stay(state);
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
      return isActive(state) ? during(state, happening) : stay(state);
  }
}

function command(state: LifecycleState, asked: RecorderCommand): Step {
  const reply = (result: CommandResult): ToDo => ({ kind: "reply", result });
  if (
    asked.type === "record" &&
    state.phase === "notRecording" &&
    state.pages.length > 0
  )
    return {
      state: {
        phase: "recording",
        starting: true,
        pages: state.pages,
        inputs: [],
        snapshotsAsked: 0,
      },
      todo: [
        ...state.pages.map((page, index): ToDo => ({
          kind: "timeline",
          add: {
            kind: "visit",
            page: page.id,
            url: page.url,
            cause: index === 0 ? "initial" : "openPage",
          },
        })),
        // Reports first: a click held before Playwright listens would be
        // passed on without ever being reported. The pages are asked to hold
        // inputs back when Playwright reports, and Record is answered when
        // they do: "applied" means that a click is now recorded.
        { kind: "browser", ask: { kind: "reportInteractions" } },
        { kind: "deferReply" },
      ],
    };
  if (asked.type === "finish" && state.phase === "recording") {
    const wrapping = wrapUp(state);
    return {
      state: wrapping.state,
      todo: [...wrapping.todo, reply("applied")],
    };
  }
  // A command that does not apply now changes nothing.
  return { state, todo: [reply("ignored")] };
}

/** An end from outside. With nothing recorded, the recorder ends "empty";
 * a recording is wrapped up and saved; a wrap-up or a save under way goes on. */
function endFromOutside(state: LifecycleState): Step {
  if (state.phase === "recording") return wrapUp(state);
  if (state.phase !== "notRecording") return stay(state);
  const outcome: RecordingOutcome = { kind: "empty" };
  return {
    state: { phase: "ended", pages: state.pages, outcome },
    todo: [{ kind: "end", outcome }],
  };
}

/**
 * Starts the wrap-up before a save. It is over when every page has confirmed
 * that it holds no input back, every held input has been passed on and has
 * its "after", a last snapshot of every page is in, and Playwright's report
 * for every input is in; or when the time limit passes.
 */
function wrapUp(state: Extract<LifecycleState, { phase: "recording" }>): Step {
  return proceed(
    {
      phase: "wrappingUp",
      pages: state.pages,
      inputs: state.inputs,
      snapshotsAsked: state.snapshotsAsked,
      gateOff: false,
      finals: null,
    },
    [
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

function save(state: LifecycleState, todo: readonly ToDo[]): Step {
  return {
    state: { phase: "saving", pages: state.pages },
    todo: [...todo, { kind: "save" }],
  };
}

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
  return state.phase === "recording"
    ? { ...state, pages, inputs }
    : {
        ...state,
        pages,
        inputs,
        finals: state.finals?.filter((final) => final.page !== page) ?? null,
      };
}

/** A recording being changed within one step. */
type Draft = {
  inputs: readonly Input[];
  snapshotsAsked: number;
  readonly todo: ToDo[];
};

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

/** The input of a page that is under way: the oldest without its "after". */
const underWay = (draft: Draft, page: string) =>
  draft.inputs.find(
    (input) => input.page === page && input.stage !== "settled"
  );

/** What the browser tells about an input while a recording is under way. */
function during(state: Active, happening: BrowserSignal): Step {
  const draft: Draft = {
    inputs: state.inputs,
    snapshotsAsked: state.snapshotsAsked,
    todo: [],
  };
  let next = state;
  switch (happening.kind) {
    case "reportingInteractions":
      if (state.phase === "recording" && state.starting)
        draft.todo.push({
          kind: "browser",
          ask: { kind: "holdInputs", on: true },
        });
      break;
    case "inputsHeld":
      if (state.phase === "wrappingUp" && !happening.on)
        next = { ...state, gateOff: true };
      if (state.phase === "recording" && state.starting && happening.on) {
        next = { ...state, starting: false };
        draft.todo.push({ kind: "replyDeferred", result: "applied" });
      }
      break;
    case "inputHeld": {
      const earlier = underWay(draft, happening.page);
      const held: Input = {
        id: happening.input,
        page: happening.page,
        stage: "waiting",
        asked: null,
        before: null,
        after: null,
        passedOnAt: null,
        report: null,
      };
      draft.inputs = [...draft.inputs, held];
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
      // A snapshot nobody waits for is of a page or an input that is gone.
      if (owners.length === 0 && !isFinal) break;
      draft.todo.push({
        kind: "timeline",
        add: { kind: "snapshot", snapshot },
      });
      for (const owner of owners) {
        if (owner.stage === "takingAfter") {
          change(draft, owner.id, {
            stage: "settled",
            after: snapshot.id,
            asked: null,
          });
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
    case "interactionReported": {
      if (!HELD_CLICK_REPORTS.has(happening.report.type)) break;
      // Reports come in the order of the inputs: this one belongs to the
      // oldest input of its page that has none, if that input is on its way.
      const input = draft.inputs.find(
        (held) => held.page === happening.page && held.report === null
      );
      if (!input || input.stage === "waiting" || input.stage === "takingBefore")
        break;
      change(draft, input.id, { report: happening.report });
      break;
    }
  }
  return proceed({ ...next, ...settle(draft) }, draft.todo);
}

const settle = (draft: Draft): Flow => ({
  inputs: draft.inputs,
  snapshotsAsked: draft.snapshotsAsked,
});

/** What follows from a recording's state as it now stands, whatever
 * happened: the next input of a free page starts, an input with everything
 * it needs is written down, and a wrap-up that has all it waited for saves. */
function proceed(state: Active, done: readonly ToDo[]): Step {
  const draft: Draft = {
    inputs: state.inputs,
    snapshotsAsked: state.snapshotsAsked,
    todo: [...done],
  };
  for (const page of new Set(draft.inputs.map((input) => input.page))) {
    const next = underWay(draft, page);
    if (next?.stage === "waiting")
      change(draft, next.id, {
        stage: "takingBefore",
        asked: askSnapshot(draft, page),
      });
  }
  for (const input of draft.inputs) {
    if (input.stage !== "settled" || !input.report || !input.before) continue;
    draft.todo.push({
      kind: "timeline",
      add: {
        kind: "interaction",
        interaction: {
          page: input.page,
          report: input.report,
          before: input.before,
          after: input.after,
          at: input.passedOnAt ?? 0,
        },
      },
    });
    draft.inputs = draft.inputs.filter((held) => held.id !== input.id);
  }
  if (state.phase === "recording")
    return { state: { ...state, ...settle(draft) }, todo: draft.todo };

  let finals = state.finals;
  if (
    state.gateOff &&
    finals === null &&
    draft.inputs.every((input) => input.stage === "settled")
  )
    // What changed after the last Interaction is picked up once, here.
    finals = state.pages.map((page) => ({
      page: page.id,
      snapshot: askSnapshot(draft, page.id),
    }));
  if (finals?.length === 0 && draft.inputs.length === 0)
    return save(state, draft.todo);
  return { state: { ...state, ...settle(draft), finals }, todo: draft.todo };
}
