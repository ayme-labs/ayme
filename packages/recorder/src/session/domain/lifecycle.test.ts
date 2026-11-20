import { describe, expect, it } from "vitest";

import type { EntryId, RecorderPhase } from "../../contract";
import {
  pictureRef,
  type InteractionReport,
  type PageId,
  type PageSnapshot,
  type SnapshotId,
} from "../../timeline/domain";
import {
  awaitsAnswer,
  initialState,
  offered,
  openAddress,
  shown,
  step,
  TRACE_STOP_LIMIT_MS,
  WRAP_UP_LIMIT_MS,
  type Happening,
  type LifecycleState,
  type HeldInput,
  type HighlightTarget,
  type InputId,
  type ToDo,
} from "./lifecycle";
import {
  entryId,
  inputId,
  pageId,
  snapshotId,
  snapshotRefOf,
} from "../../test-utils/ids";

// The ids these rows name, as the browser and the lifecycle make them.
const change1 = entryId("change_1");
const input1 = inputId("input_1");
const input2 = inputId("input_2");
const input3 = inputId("input_3");
const input9 = inputId("input_9");
const interaction1 = entryId("interaction_1");
const interaction2 = entryId("interaction_2");
const page1 = pageId("page_1");
const page2 = pageId("page_2");
const page9 = pageId("page_9");
const reported1 = inputId("reported_1");
const reported2 = inputId("reported_2");
const snapshot1 = snapshotId("snapshot_1");
const snapshot2 = snapshotId("snapshot_2");
const snapshot3 = snapshotId("snapshot_3");
const snapshot4 = snapshotId("snapshot_4");
const snapshot5 = snapshotId("snapshot_5");
const snapshot6 = snapshotId("snapshot_6");
const snapshot9 = snapshotId("snapshot_9");

// The lifecycle as a table: things that happened, in order, must give this
// state and these lists of things to do. No browser, no clock.

const url = "http://shop.test/";
const opened: Happening = { kind: "pageOpened", page: page1, url };
const record: Happening = { kind: "command", command: { type: "record" } };
const finish: Happening = { kind: "command", command: { type: "finish" } };
const reporting: Happening = { kind: "reportingInteractions", on: true };
const holding: Happening = { kind: "inputsHeld", on: true };
const traceStarted: Happening = { kind: "traceStarted" };
/** Record, up to the pages holding inputs back. */
const started = [record, traceStarted, reporting, holding];
const outsideEnd: Happening = { kind: "outsideEnd" };
const clickHeld = (input: InputId): Happening => ({
  kind: "inputHeld",
  input,
  page: page1,
});
const snapshot = (id: SnapshotId): PageSnapshot => ({
  id,
  page: page1,
  url,
  at: 10,
  tree: `- button "Add" [ref=e2]`,
});
const taken = (id: SnapshotId): Happening => ({
  kind: "snapshotTaken",
  snapshot: snapshot(id),
});
const passedOn = (input: InputId, at = 20): Happening => ({
  kind: "inputPassedOn",
  input,
  at,
});
const settled = (input: InputId): Happening => ({
  kind: "pageSettled",
  page: page1,
  input,
});
const click: InteractionReport = {
  type: "click",
  selector: "internal:role=button",
  target: null,
  values: { button: "left" },
};
const reported: Happening = {
  kind: "interactionReported",
  page: page1,
  report: click,
};
const gateOff: Happening = { kind: "inputsHeld", on: false };
const saved: Happening = { kind: "saved", folder: "/project/rec_1" };

// What the lifecycle asks for, in short.
const reply = (result: "applied" | "ignored"): ToDo => ({
  kind: "reply",
  result,
});
const takeSnapshot = (id: SnapshotId): ToDo => ({
  kind: "browser",
  ask: { kind: "takeSnapshot", snapshot: id, page: page1 },
});
const keep = (id: SnapshotId): ToDo => ({
  kind: "timeline",
  add: { kind: "snapshot", snapshot: snapshot(id) },
});
const passOn = (input: InputId): ToDo => ({
  kind: "browser",
  ask: { kind: "passOn", input },
});
const waitForSettled = (input: InputId): ToDo => ({
  kind: "browser",
  ask: { kind: "waitForSettled", page: page1, input },
});
const interaction = (
  before: SnapshotId,
  after: SnapshotId | null,
  at = 20
): ToDo => ({
  kind: "timeline",
  add: {
    kind: "interaction",
    interaction: { page: page1, report: click, before, after, at },
  },
});
const startVisit: ToDo = {
  kind: "timeline",
  add: { kind: "visit", page: page1, url, cause: "initial" },
};
const startTrace: ToDo = { kind: "browser", ask: { kind: "startTrace" } };
const reportInteractions: ToDo = {
  kind: "browser",
  ask: { kind: "reportInteractions", on: true },
};
const holdInputs: ToDo = {
  kind: "browser",
  ask: { kind: "holdInputs", on: true },
};
const recordApplied: ToDo = { kind: "replyDeferred", result: "applied" };
const holdNoMore: ToDo = {
  kind: "browser",
  ask: { kind: "holdInputs", on: false },
};
const startTimeLimit: ToDo = { kind: "startTimeLimit", ms: WRAP_UP_LIMIT_MS };
/** A wrap-up with nothing under way: the pages hold inputs back no more at
 * once. */
const wrapUp: ToDo[] = [holdNoMore, startTimeLimit];
const trace = { file: "/tmp/trace.zip", positions: { snapshot_1: "11" } };
// Stopping a trace is given a time: a browser that never answers keeps
// neither a save nor a Clear waiting for ever.
const stopTrace: ToDo = {
  kind: "browser",
  ask: { kind: "stopTrace", keep: true },
  within: TRACE_STOP_LIMIT_MS,
};
const discardTrace: ToDo = {
  kind: "browser",
  ask: { kind: "stopTrace", keep: false },
  within: TRACE_STOP_LIMIT_MS,
};
const traceStopped: Happening = { kind: "traceStopped", trace };
const traceDiscarded: Happening = { kind: "traceDiscarded" };
const save: ToDo = { kind: "save", trace };

// Ticket #1273: the commands, and Playwright's recorder switched off.
const stop: Happening = { kind: "command", command: { type: "stop" } };
const resume: Happening = { kind: "command", command: { type: "continue" } };
const clear: Happening = { kind: "command", command: { type: "clear" } };
const reportingOff: Happening = { kind: "reportingInteractions", on: false };
const stopReporting: ToDo = {
  kind: "browser",
  ask: { kind: "reportInteractions", on: false },
};
/** The browser could not carry out a request. */
const failed = (ask: ToDo): Happening => {
  if (ask.kind !== "browser") throw new Error("Not a request.");
  return { kind: "requestFailed", request: ask.ask, reason: "It broke." };
};
const cannotStart: ToDo = {
  kind: "end",
  outcome: { kind: "failed", reason: "Recording could not start. It broke." },
};
/** From a page being opened to Paused, with nothing recorded. */
const stopped = [
  opened,
  ...started,
  stop,
  gateOff,
  taken(snapshot1),
  reportingOff,
];
// Visits.
const navigated = (to: string, page = page1): Happening => ({
  kind: "pageNavigated",
  page,
  url: to,
});
const visitAt = (
  at: string,
  cause: "initial" | "navigate" | "openPage",
  page = page1
): ToDo => ({
  kind: "timeline",
  add: { kind: "visit", page, url: at, cause },
});
// Every kind of input.
const letThrough = (upTo: InputId | null): ToDo => ({
  kind: "browser",
  ask: { kind: "letInputsThrough", page: page1, upTo },
});

/** One click from held to settled, with nothing else going on. */
const oneClick = [
  clickHeld(input1),
  taken(snapshot1),
  passedOn(input1),
  settled(input1),
  taken(snapshot2),
];

/**
 * The lists as they read before typing showed while it was typed: a fill is
 * written once, when it is final, under no key. Final is when it has left
 * the lifecycle's inputs: what is told of it before then only shows, and is
 * held by the rows of "the lifecycle, for a fill while it is typed".
 */
function writes({
  todo,
  showing,
}: {
  todo: readonly (readonly ToDo[])[];
  showing: readonly ReadonlySet<string>[];
}): ToDo[][] {
  return todo.map((step, at) =>
    step.flatMap((item): ToDo[] => {
      if (item.kind !== "timeline" || item.add.kind !== "interaction")
        return [item];
      const { key, ...add } = item.add;
      if (key === undefined) return [item];
      return showing[at]!.has(key) ? [] : [{ ...item, add }];
    })
  );
}

/** The fills that show and can still change, by the key the timeline knows
 * each by: the lifecycle's inputs known from their report that it has told. */
function showingIn(state: LifecycleState): ReadonlySet<string> {
  const { inputs = [] } = state as {
    inputs?: readonly {
      id: string;
      before: string | null;
      held: { kind: string };
      told: unknown;
    }[];
  };
  return new Set(
    inputs
      .filter((input) => input.held.kind === "reported" && input.told !== null)
      .map((input) => `${input.before}:${input.id}`)
  );
}

/** Everything the lifecycle asked for along the way, which fills show after
 * each step, and where it stands. */
function run(happened: readonly Happening[]) {
  let state = initialState;
  const todo: ToDo[][] = [];
  const showing: ReadonlySet<string>[] = [];
  for (const happening of happened) {
    const next = step(state, happening);
    state = next.state;
    todo.push([...next.todo]);
    showing.push(showingIn(state));
  }
  return { state: shown(state), todo, showing };
}

describe("the lifecycle", () => {
  it("starts not recording", () => {
    expect(shown(initialState)).toEqual({ phase: "notRecording" });
  });

  it.each<{
    name: string;
    happened: Happening[];
    /** The lists of the last steps, one per step. */
    todo: ToDo[][];
    /** The phase it shows; what a wrap-up leads to may be left out. */
    state: Partial<RecorderPhase>;
  }>([
    // Before anything is recorded.
    {
      name: "an outside end before anything was recorded ends with 'empty'",
      happened: [outsideEnd],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "closing the last page is an outside end",
      happened: [opened, { kind: "pageClosed", page: page1, pagesLeft: 0 }],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "closing a page while another is open changes nothing",
      happened: [
        opened,
        { kind: "pageOpened", page: page2, url },
        { kind: "pageClosed", page: page2, pagesLeft: 1 },
      ],
      todo: [[]],
      state: { phase: "notRecording" },
    },
    {
      name: "a browser that disappears is an outside end",
      happened: [{ kind: "browserGone" }],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "a second outside end does nothing",
      happened: [outsideEnd, outsideEnd],
      todo: [[]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "the browser going away after the end does nothing",
      happened: [outsideEnd, { kind: "browserGone" }],
      todo: [[]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "Finish with nothing recorded is ignored",
      happened: [opened, finish],
      todo: [[reply("ignored")]],
      state: { phase: "notRecording" },
    },
    {
      name: "a command after the end is ignored",
      happened: [outsideEnd, record],
      todo: [[reply("ignored")]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // Record.
    {
      name: "Record starts a Visit for the open page and has Interactions reported; its answer waits",
      happened: [opened, record],
      todo: [[startVisit, startTrace, { kind: "deferReply" }]],
      // Record is not answered yet: nothing is recorded, so it is not shown.
      state: { phase: "notRecording" },
    },
    {
      name: "once the trace is started, Playwright is asked to report Interactions",
      happened: [opened, record, traceStarted],
      todo: [[reportInteractions]],
      state: { phase: "notRecording" },
    },
    {
      name: "once Playwright reports Interactions, the pages are asked to hold inputs back",
      happened: [opened, record, traceStarted, reporting],
      todo: [[holdInputs]],
      state: { phase: "notRecording" },
    },
    {
      name: "once the pages hold inputs back, Record is answered",
      happened: [opened, record, traceStarted, reporting, holding],
      todo: [[recordApplied]],
      state: { phase: "recording" },
    },
    {
      name: "the Visit Record starts is for the page as it is now, not as it opened",
      happened: [
        opened,
        {
          kind: "pageNavigated",
          page: page1,
          url: "http://shop.test/cart",
        },
        record,
      ],
      todo: [
        [
          {
            kind: "timeline",
            add: {
              kind: "visit",
              page: page1,
              url: "http://shop.test/cart",
              cause: "initial",
            },
          },
          startTrace,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "notRecording" },
    },
    {
      name: "Record with no page open is ignored",
      happened: [record],
      todo: [[reply("ignored")]],
      state: { phase: "notRecording" },
    },
    {
      name: "Record while recording is ignored",
      happened: [opened, ...started, record],
      todo: [[reply("ignored")]],
      state: { phase: "recording" },
    },
    {
      name: "Record pressed again before the first is answered is ignored, and the first still waits",
      happened: [opened, record, record, traceStarted, reporting, holding],
      todo: [
        [reply("ignored")],
        [reportInteractions],
        [holdInputs],
        [recordApplied],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click held before every page has confirmed is recorded like any other",
      happened: [opened, record, traceStarted, reporting, clickHeld(input1)],
      todo: [[takeSnapshot(snapshot1)]],
      state: { phase: "notRecording" },
    },
    {
      name: "Finish before the pages hold inputs back answers Record, then wraps up",
      happened: [opened, record, finish, traceStarted, reporting, holding],
      todo: [[recordApplied, ...wrapUp, reply("applied")], [], [], []],
      state: { phase: "wrappingUp" },
    },
    {
      name: "an outside end before the pages hold inputs back answers Record, then wraps up",
      happened: [opened, record, outsideEnd],
      todo: [[recordApplied, ...wrapUp]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a breakdown before the pages hold inputs back answers Record",
      happened: [opened, record, { kind: "brokeDown", reason: "no recorder" }],
      todo: [
        [
          recordApplied,
          { kind: "end", outcome: { kind: "failed", reason: "no recorder" } },
        ],
      ],
      state: {
        phase: "ended",
        outcome: { kind: "failed", reason: "no recorder" },
      },
    },
    {
      name: "a click before Record is not the recorder's: nothing is held, and its report is ignored",
      happened: [opened, reported],
      todo: [[]],
      state: { phase: "notRecording" },
    },

    // A held click.
    {
      name: "a held click gets its 'before', is passed on, and gets its 'after' once the page is settled",
      happened: [opened, ...started, ...oneClick],
      todo: [
        [takeSnapshot(snapshot1)],
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), letThrough(input1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the Interaction is written down when Playwright's report arrives after the 'after'",
      happened: [opened, ...started, ...oneClick, reported],
      todo: [[interaction(snapshot1, snapshot2)]],
      state: { phase: "recording" },
    },
    {
      name: "the Interaction is written down with its 'after' when the report came first",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1, 33),
        reported,
        settled(input1),
        taken(snapshot2),
      ],
      todo: [
        [],
        [takeSnapshot(snapshot2)],
        [
          keep(snapshot2),
          interaction(snapshot1, snapshot2, 33),
          letThrough(input1),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a report with no held input to belong to is ignored",
      happened: [opened, ...started, reported],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a report of an input the gate does not hold claims no held click",
      happened: [
        opened,
        ...started,
        ...oneClick,
        {
          kind: "interactionReported",
          page: page1,
          report: { ...click, type: "fill" },
        },
      ],
      todo: [[waitForSettled(reported1)]],
      state: { phase: "recording" },
    },
    {
      name: "a second click waits while the first is given its 'before' and passed on, then one snapshot is the first's 'after' and the second's 'before'",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        clickHeld(input2),
        taken(snapshot1),
        passedOn(input1),
        taken(snapshot2),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [keep(snapshot1), passOn(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), passOn(input2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click held while the page is still settling ends the wait: its 'before' is the earlier click's 'after'",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        clickHeld(input2),
        // The wait that was cut short ends later: nothing more is asked.
        settled(input1),
        taken(snapshot2),
      ],
      todo: [
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [],
        [keep(snapshot2), passOn(input2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click held while the earlier click's 'after' is being taken gets a 'before' of its own",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        clickHeld(input2),
        taken(snapshot2),
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot2)],
        [],
        [keep(snapshot2), takeSnapshot(snapshot3)],
        [keep(snapshot3), passOn(input2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "reports go to held clicks in the order the clicks were held",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1, 21),
        clickHeld(input2),
        taken(snapshot2),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
        reported,
        reported,
      ],
      todo: [
        [interaction(snapshot1, snapshot2, 21)],
        [interaction(snapshot2, snapshot3, 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a snapshot nobody waits for is not kept",
      happened: [opened, ...started, taken(snapshot9)],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a click whose page closes before it is passed on is dropped",
      happened: [
        opened,
        { kind: "pageOpened", page: page2, url },
        ...started,
        clickHeld(input1),
        { kind: "pageClosed", page: page1, pagesLeft: 1 },
        taken(snapshot1),
      ],
      todo: [[takeSnapshot(snapshot1)], [], []],
      state: { phase: "recording" },
    },
    {
      name: "a click whose page closes after it was passed on keeps its 'before' only",
      happened: [
        opened,
        { kind: "pageOpened", page: page2, url },
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        { kind: "pageClosed", page: page1, pagesLeft: 1 },
        reported,
      ],
      todo: [[], [interaction(snapshot1, null)]],
      state: { phase: "recording" },
    },

    // Finish.
    {
      name: "Finish stops holding inputs and starts the wrap-up time limit",
      happened: [opened, ...started, finish],
      todo: [[...wrapUp, reply("applied")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "once the pages confirm that no input is held, the wrap-up takes a last snapshot, then saves",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        traceStopped,
        saved,
      ],
      todo: [
        [keep(snapshot1), stopTrace],
        [save],
        [{ kind: "end", outcome: { kind: "saved", folder: "/project/rec_1" } }],
      ],
      state: {
        phase: "ended",
        outcome: { kind: "saved", folder: "/project/rec_1" },
      },
    },
    {
      name: "the recorder shows that it is saving while the package is written",
      happened: [opened, ...started, finish, gateOff, taken(snapshot1)],
      todo: [[keep(snapshot1), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "Finish after a recorded click saves once the last snapshot is in",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        finish,
        gateOff,
        taken(snapshot3),
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "Finish while a click is held: the click is passed on and is in the package, and the pages hold inputs back until it has its 'after'",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        finish,
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
        gateOff,
        reported,
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [startTimeLimit, reply("applied")],
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), holdNoMore],
        [takeSnapshot(snapshot3)],
        [interaction(snapshot1, snapshot2)],
        [keep(snapshot3), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a click held after Finish, before the pages confirm, is still passed on and recorded",
      happened: [
        opened,
        ...started,
        finish,
        clickHeld(input1),
        gateOff,
        taken(snapshot1),
        passedOn(input1),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a click held after Stop while an earlier click's page still changes ends that click at its own 'before', and is recorded with its own change",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        stop,
        clickHeld(input2),
        taken(snapshot2),
        passedOn(input2),
        settled(input2),
        taken(snapshot3),
        reported,
        reported,
        gateOff,
      ],
      todo: [
        [startTimeLimit, reply("applied")],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), passOn(input2)],
        [waitForSettled(input2)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), holdNoMore],
        [interaction(snapshot1, snapshot2)],
        [interaction(snapshot2, snapshot3)],
        [takeSnapshot(snapshot4)],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a click held after Stop is saved when the recorder is ended from outside before it has its 'after'",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        stop,
        clickHeld(input2),
        outsideEnd,
        taken(snapshot2),
        passedOn(input2),
        settled(input2),
        taken(snapshot3),
        reported,
        reported,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [],
        [keep(snapshot2), passOn(input2)],
        [waitForSettled(input2)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), holdNoMore],
        [interaction(snapshot1, snapshot2)],
        [interaction(snapshot2, snapshot3)],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "the wrap-up waits for the report of a click that was already passed on",
      happened: [
        opened,
        ...started,
        ...oneClick,
        finish,
        gateOff,
        taken(snapshot3),
        reported,
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [interaction(snapshot1, snapshot2), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "when the time limit passes, the wrap-up saves without the report that never came",
      happened: [
        opened,
        ...started,
        ...oneClick,
        finish,
        gateOff,
        taken(snapshot3),
        { kind: "timeLimitPassed" },
      ],
      todo: [[keep(snapshot3)], [stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "the time limit passing after the save has begun does nothing",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        { kind: "timeLimitPassed" },
      ],
      todo: [[]],
      state: { phase: "saving" },
    },
    {
      name: "Finish pressed twice saves once: the second is ignored while wrapping up",
      happened: [opened, ...started, finish, finish],
      todo: [[reply("ignored")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Finish pressed twice saves once: the second is ignored while saving",
      happened: [opened, ...started, finish, gateOff, taken(snapshot1), finish],
      todo: [[reply("ignored")]],
      state: { phase: "saving" },
    },
    {
      name: "Finish after the package is saved is ignored",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        traceStopped,
        saved,
        finish,
      ],
      todo: [[reply("ignored")]],
      state: {
        phase: "ended",
        outcome: { kind: "saved", folder: "/project/rec_1" },
      },
    },
    {
      name: "a recording with nothing to save ends with 'empty'",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        traceStopped,
        { kind: "saved", folder: null },
      ],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // The trace (ticket #1274): one per recording, from the first Record to
    // the save, through every pause. Clear throws it away.
    {
      name: "Stop leaves the trace running: only Playwright's recorder is switched off",
      happened: [...stopped],
      todo: [[keep(snapshot1), stopReporting], []],
      state: { phase: "paused" },
    },
    {
      name: "Continue goes on in the trace that is running",
      happened: [...stopped, resume],
      todo: [[reportInteractions, { kind: "deferReply" }]],
      state: { phase: "paused" },
    },
    {
      name: "Finish while paused stops the trace, and the package is written once it is stopped",
      happened: [...stopped, finish, traceStopped],
      todo: [[reply("applied"), stopTrace], [save]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while paused stops the trace and saves",
      happened: [...stopped, outsideEnd, traceStopped],
      todo: [[stopTrace], [save]],
      state: { phase: "saving" },
    },
    {
      name: "the package is written once, whatever tells of the stopped trace again",
      happened: [...stopped, finish, traceStopped, traceStopped],
      todo: [[save], []],
      state: { phase: "saving" },
    },
    {
      name: "a trace that cannot be stopped does not lose the recording: the package is written without it",
      happened: [...stopped, finish, failed(stopTrace)],
      todo: [[{ kind: "save" }]],
      state: { phase: "saving" },
    },
    {
      name: "Finish is ignored while the trace is being stopped",
      happened: [...stopped, finish, finish],
      todo: [[reply("ignored")]],
      state: { phase: "saving" },
    },
    {
      name: "a trace that is thrown away and cannot be stopped changes nothing",
      happened: [...stopped, clear, failed(discardTrace)],
      todo: [[{ kind: "clear" }]],
      state: { phase: "notRecording" },
    },
    {
      name: "a trace that breaks after Record was answered changes nothing",
      happened: [opened, ...started, failed(startTrace)],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a new recording after Clear starts a new trace",
      happened: [...stopped, clear, traceDiscarded, record],
      todo: [[startVisit, startTrace, { kind: "deferReply" }]],
      state: { phase: "notRecording" },
    },

    // The trace's order (review of ticket #1274): the lifecycle decides it,
    // and the browser only carries it out. A trace is started before the
    // recorder reports, and thrown away before Clear is over.
    {
      name: "a wrap-up does not take its last snapshots before the trace is started: a mark needs a trace",
      happened: [opened, record, finish, gateOff],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "once the trace is started, the wrap-up that waited takes its last snapshots",
      happened: [opened, record, finish, gateOff, traceStarted],
      todo: [[takeSnapshot(snapshot1)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Clear is not over before the trace is confirmed gone: the recorder is still wrapping up",
      happened: [
        opened,
        ...started,
        clear,
        gateOff,
        taken(snapshot1),
        reportingOff,
      ],
      todo: [[discardTrace]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Record pressed while the trace is being thrown away is answered 'ignored'",
      happened: [
        opened,
        ...started,
        clear,
        gateOff,
        taken(snapshot1),
        reportingOff,
        record,
      ],
      todo: [[reply("ignored")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "once the trace is gone, Clear is over, and Record starts a new trace",
      happened: [
        opened,
        ...started,
        clear,
        gateOff,
        taken(snapshot1),
        reportingOff,
        traceDiscarded,
        record,
      ],
      todo: [[startVisit, startTrace, { kind: "deferReply" }]],
      state: { phase: "notRecording" },
    },
    {
      name: "a trace that cannot be thrown away still ends Clear: nothing waits for an answer that cannot come",
      happened: [
        opened,
        ...started,
        clear,
        gateOff,
        taken(snapshot1),
        reportingOff,
        failed(discardTrace),
      ],
      todo: [[{ kind: "clear" }]],
      state: { phase: "notRecording" },
    },
    {
      name: "Clear while paused waits for the trace too, and answers Record 'ignored' meanwhile",
      happened: [...stopped, clear, record],
      todo: [[reply("ignored")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the answer that the trace is gone is told once: a second one changes nothing",
      happened: [...stopped, clear, traceDiscarded, traceDiscarded],
      todo: [[]],
      state: { phase: "notRecording" },
    },
    {
      name: "the wrap-up's time limit passing while the trace is thrown away does not ask for it again",
      happened: [
        opened,
        ...started,
        clear,
        gateOff,
        taken(snapshot1),
        reportingOff,
        { kind: "timeLimitPassed" },
      ],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "an outside end while the trace is thrown away ends 'empty' once it is gone",
      happened: [
        opened,
        ...started,
        clear,
        gateOff,
        taken(snapshot1),
        reportingOff,
        outsideEnd,
        traceDiscarded,
      ],
      todo: [[{ kind: "clear" }, { kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // A breakdown.
    {
      name: "a recorder that breaks down ends 'failed' with the reason",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        { kind: "brokeDown", reason: "ENOSPC: no space left on device" },
      ],
      todo: [
        [
          {
            kind: "end",
            outcome: {
              kind: "failed",
              reason: "ENOSPC: no space left on device",
            },
          },
        ],
      ],
      state: {
        phase: "ended",
        outcome: { kind: "failed", reason: "ENOSPC: no space left on device" },
      },
    },
    {
      name: "a breakdown after the end changes nothing",
      happened: [outsideEnd, { kind: "brokeDown", reason: "too late" }],
      todo: [[]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // An end from outside while recording.
    {
      name: "an outside end while recording wraps up and saves, as Finish does",
      happened: [opened, ...started, outsideEnd, gateOff, taken(snapshot1)],
      todo: [wrapUp, [takeSnapshot(snapshot1)], [keep(snapshot1), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while wrapping up joins the wrap-up already running",
      happened: [opened, ...started, finish, outsideEnd],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "an outside end while saving joins the save already running",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        outsideEnd,
      ],
      todo: [[]],
      state: { phase: "saving" },
    },
    {
      name: "closing the last page while recording saves what was recorded, with no last snapshot of it",
      happened: [
        opened,
        ...started,
        { kind: "pageClosed", page: page1, pagesLeft: 0 },
        gateOff,
      ],
      todo: [wrapUp, [stopTrace]],
      state: { phase: "saving" },
    },

    // Visits.
    {
      name: "a page that goes to another address while recording starts a Visit there",
      happened: [opened, ...started, navigated("http://shop.test/cart")],
      todo: [[visitAt("http://shop.test/cart", "navigate")]],
      state: { phase: "recording" },
    },
    {
      name: "a page opened while recording starts a Visit of its own",
      happened: [
        opened,
        ...started,
        {
          kind: "pageOpened",
          page: page2,
          url: "http://shop.test/help",
        },
      ],
      todo: [[visitAt("http://shop.test/help", "openPage", page2)]],
      state: { phase: "recording" },
    },
    {
      name: "a page opened blank while recording starts its Visit at the first address it goes to",
      happened: [
        opened,
        ...started,
        { kind: "pageOpened", page: page2, url: "about:blank" },
        navigated("http://shop.test/help", page2),
        navigated("http://shop.test/faq", page2),
      ],
      todo: [
        [],
        [visitAt("http://shop.test/help", "openPage", page2)],
        [visitAt("http://shop.test/faq", "navigate", page2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a page that goes elsewhere while not recording starts no Visit",
      happened: [opened, navigated("http://shop.test/cart")],
      todo: [[]],
      state: { phase: "notRecording" },
    },
    {
      name: "a held click whose document is gone before it reaches it is dropped, and the next click goes on",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        clickHeld(input2),
        taken(snapshot1),
        navigated("http://shop.test/cart"),
        { kind: "inputGone", input: input1 },
        // A report of the click is of no held click any more.
        reported,
      ],
      todo: [
        [keep(snapshot1), passOn(input1)],
        [visitAt("http://shop.test/cart", "navigate")],
        [takeSnapshot(snapshot2)],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a held click whose document is gone while wrapping up is dropped, and the recording saves",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        finish,
        { kind: "inputGone", input: input1 },
        gateOff,
        taken(snapshot2),
      ],
      todo: [
        [holdNoMore],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a page that went elsewhere while paused starts a Visit there at Continue, and the timeline is told at once that it left its Visit",
      happened: [...stopped, navigated("http://shop.test/cart"), resume],
      todo: [
        [
          {
            kind: "timeline",
            add: {
              kind: "elsewhere",
              page: page1,
              url: "http://shop.test/cart",
            },
          },
        ],
        [
          visitAt("http://shop.test/cart", "navigate"),
          reportInteractions,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "paused" },
    },
    {
      name: "a page that goes elsewhere twice while paused, first by its hash alone, has the timeline told each time: the second leaves its Visit",
      happened: [
        ...stopped,
        navigated(`${url}#reviews`),
        navigated("http://shop.test/cart"),
      ],
      todo: [
        [
          {
            kind: "timeline",
            add: { kind: "elsewhere", page: page1, url: `${url}#reviews` },
          },
        ],
        [
          {
            kind: "timeline",
            add: {
              kind: "elsewhere",
              page: page1,
              url: "http://shop.test/cart",
            },
          },
        ],
      ],
      state: { phase: "paused" },
    },
    {
      name: "a page opened while paused starts a Visit of its own at Continue",
      happened: [
        ...stopped,
        { kind: "pageOpened", page: page2, url: "about:blank" },
        navigated("http://shop.test/help", page2),
        resume,
      ],
      todo: [
        [],
        [],
        [
          visitAt("http://shop.test/help", "openPage", page2),
          reportInteractions,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "paused" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    // A row names the state it is about; what a wrap-up leads to has rows
    // of its own (ticket #1276).
    expect(result.state).toMatchObject(state);
  });

  // Ticket #1273, the full lifecycle: Stop, Continue, Clear, and every way
  // out of each state. A row that is a bug path of the lifecycle model says
  // which rule of the spec it keeps.
  it.each<{
    name: string;
    happened: Happening[];
    /** The lists of the last steps, one per step. */
    todo: ToDo[][];
    /** The phase it shows; what a wrap-up leads to may be left out. */
    state: Partial<RecorderPhase>;
  }>([
    // Stop.
    {
      name: "Stop wraps up as Finish does, and is answered at once",
      happened: [opened, ...started, stop],
      todo: [[...wrapUp, reply("applied")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "once nothing is held back and the last snapshot is in, a wrap-up after Stop has Playwright's recorder switched off",
      happened: [opened, ...started, stop, gateOff, taken(snapshot1)],
      todo: [[takeSnapshot(snapshot1)], [keep(snapshot1), stopReporting]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the recorder is not paused before the pages confirm that they hold nothing back, whatever else is in (rule 3)",
      happened: [opened, ...started, stop, reportingOff, taken(snapshot1)],
      todo: [[], []],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the recorder is paused once Playwright's recorder is off",
      happened: [...stopped],
      todo: [[]],
      state: { phase: "paused" },
    },
    {
      name: "while wrapping up, every command is ignored (rule 10)",
      happened: [opened, ...started, stop, stop, resume, clear, record, finish],
      todo: [
        [reply("ignored")],
        [reply("ignored")],
        [reply("ignored")],
        [reply("ignored")],
        [reply("ignored")],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a click held after Stop, before the pages confirm, is still recorded: the recorder is paused only after it",
      happened: [
        opened,
        ...started,
        stop,
        clickHeld(input1),
        gateOff,
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
        reported,
        taken(snapshot3),
        reportingOff,
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), takeSnapshot(snapshot3)],
        [interaction(snapshot1, snapshot2)],
        [keep(snapshot3), stopReporting],
        [],
      ],
      state: { phase: "paused" },
    },
    {
      name: "Stop right after a click: the recorder is paused only once the click's report is in, so the report is not thrown away (rule 13)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        stop,
        gateOff,
        taken(snapshot3),
        reported,
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [interaction(snapshot1, snapshot2), stopReporting],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "when the time limit passes, a wrap-up after Stop pauses without the report that never came",
      happened: [
        opened,
        ...started,
        ...oneClick,
        stop,
        gateOff,
        taken(snapshot3),
        { kind: "timeLimitPassed" },
      ],
      todo: [[keep(snapshot3)], [stopReporting]],
      state: { phase: "paused" },
    },
    {
      name: "when the time limit passes with a click still held, the click is passed on all the same (rule 1)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        clickHeld(input2),
        stop,
        { kind: "timeLimitPassed" },
      ],
      todo: [[holdNoMore, passOn(input1), passOn(input2), stopReporting]],
      state: { phase: "paused" },
    },
    {
      name: "when the time limit passes on a Finish with a click still held, the click is passed on before the save (rule 1)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        finish,
        { kind: "timeLimitPassed" },
      ],
      todo: [[holdNoMore, passOn(input1), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "the time limit passing while Playwright's recorder is switched off pauses at once",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken(snapshot1),
        { kind: "timeLimitPassed" },
        reportingOff,
      ],
      todo: [[], []],
      state: { phase: "paused" },
    },

    // Paused.
    {
      name: "a report that arrives while paused is ignored: nothing done while not recording appears (rules 3 and 13)",
      happened: [...stopped, reported],
      todo: [[]],
      state: { phase: "paused" },
    },
    {
      name: "a click a page still held back while paused is passed on at once, and is not recorded (rules 1 and 3)",
      happened: [...stopped, clickHeld(input1), passedOn(input1), reported],
      todo: [[passOn(input1)], [], []],
      state: { phase: "paused" },
    },
    {
      name: "a click a page held back before Record is passed on at once (rule 1)",
      happened: [opened, clickHeld(input1)],
      todo: [[passOn(input1)]],
      state: { phase: "notRecording" },
    },
    {
      name: "a click a page held back while the package is saved is passed on at once (rule 1)",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken(snapshot1),
        clickHeld(input1),
      ],
      todo: [[passOn(input1)]],
      state: { phase: "saving" },
    },
    {
      name: "while paused, Stop and Record are ignored: no command is a toggle",
      happened: [...stopped, stop, record],
      todo: [[reply("ignored")], [reply("ignored")]],
      state: { phase: "paused" },
    },

    // Continue.
    {
      name: "Continue has Playwright report Interactions again, starts no Visit, and its answer waits",
      happened: [...stopped, resume],
      todo: [[reportInteractions, { kind: "deferReply" }]],
      state: { phase: "paused" },
    },
    {
      name: "Continue is answered once the pages hold inputs back again, and the page is read as it stands then",
      happened: [...stopped, resume, reporting, holding],
      todo: [[holdInputs], [recordApplied, takeSnapshot(snapshot2)]],
      state: { phase: "recording" },
    },
    {
      name: "after Continue the snapshots go on counting: the timeline is the same one, and a 'before' comes after every earlier 'after' (rule 12)",
      happened: [...stopped, resume, reporting, holding, clickHeld(input1)],
      todo: [[takeSnapshot(snapshot3)]],
      state: { phase: "recording" },
    },
    {
      name: "a report of a click made while paused that arrives after Continue claims nothing (rule 3)",
      happened: [...stopped, resume, reporting, holding, reported],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "Continue with nothing paused is ignored",
      happened: [opened, resume, ...started, resume],
      todo: [
        [reply("ignored")],
        ...started.map(() => expect.anything()),
        [reply("ignored")],
      ],
      state: { phase: "recording" },
    },

    // Clear.
    {
      name: "Clear while recording wraps up, and is answered at once",
      happened: [opened, ...started, clear],
      todo: [[...wrapUp, reply("applied")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "once a wrap-up after Clear is over, everything recorded is thrown away and the recorder is not recording (rule 5)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        clear,
        gateOff,
        taken(snapshot3),
        reportingOff,
        traceDiscarded,
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), stopReporting],
        [discardTrace],
        [{ kind: "clear" }],
      ],
      state: { phase: "notRecording" },
    },
    {
      name: "a wrap-up after Clear waits for the report of a click that was passed on, so that it cannot arrive in the next recording (rule 5)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        clear,
        gateOff,
        taken(snapshot3),
        reported,
      ],
      todo: [
        [keep(snapshot3)],
        [interaction(snapshot1, snapshot2), stopReporting],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a report the time limit gave up on is ignored after Clear, also once Record is pressed again (rule 5)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        clear,
        gateOff,
        taken(snapshot3),
        { kind: "timeLimitPassed" },
        reported,
        traceDiscarded,
        ...started,
        reported,
      ],
      todo: [
        [stopReporting, discardTrace],
        [],
        [{ kind: "clear" }],
        [startVisit, startTrace, { kind: "deferReply" }],
        [reportInteractions],
        [holdInputs],
        [recordApplied],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Clear while paused is answered at once, and throws everything away when the trace is gone",
      happened: [...stopped, clear, traceDiscarded],
      todo: [[discardTrace, reply("applied")], [{ kind: "clear" }]],
      state: { phase: "notRecording" },
    },
    {
      name: "after Clear, Record starts a recording of its own: a new Visit, and the first snapshot",
      happened: [
        ...stopped,
        clear,
        traceDiscarded,
        ...started,
        clickHeld(input1),
      ],
      todo: [
        [startVisit, startTrace, { kind: "deferReply" }],
        [reportInteractions],
        [holdInputs],
        [recordApplied],
        [takeSnapshot(snapshot1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Clear with nothing recorded is ignored",
      happened: [opened, clear],
      todo: [[reply("ignored")]],
      state: { phase: "notRecording" },
    },

    // Finish and an end from outside, from every state (rule 9).
    {
      name: "Finish while paused is answered and saves at once: nothing is under way, and nothing of the pause is read",
      happened: [...stopped, finish],
      todo: [[reply("applied"), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while paused saves what was recorded",
      happened: [...stopped, outsideEnd, outsideEnd],
      todo: [[stopTrace], []],
      state: { phase: "saving" },
    },
    {
      name: "closing the last page while paused saves what was recorded",
      happened: [...stopped, { kind: "pageClosed", page: page1, pagesLeft: 0 }],
      todo: [[stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end during a wrap-up after Stop turns it into a save",
      happened: [
        opened,
        ...started,
        stop,
        outsideEnd,
        gateOff,
        taken(snapshot1),
      ],
      todo: [[], [takeSnapshot(snapshot1)], [keep(snapshot1), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while Playwright's recorder is switched off after Stop saves once that is done",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken(snapshot1),
        outsideEnd,
        reportingOff,
      ],
      todo: [[], [stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end during a wrap-up after Clear still throws everything away, and ends with 'empty'",
      happened: [
        opened,
        ...started,
        clear,
        outsideEnd,
        gateOff,
        taken(snapshot1),
        traceDiscarded,
      ],
      todo: [
        [],
        [takeSnapshot(snapshot1)],
        [keep(snapshot1), discardTrace],
        [{ kind: "clear" }, { kind: "end", outcome: { kind: "empty" } }],
      ],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "an outside end after Clear ends with 'empty'",
      happened: [...stopped, clear, outsideEnd, traceDiscarded],
      todo: [[{ kind: "clear" }, { kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // A request the browser could not carry out: nothing waits for ever.
    {
      name: "Record is answered 'ignored' and the recorder ends 'failed' when Playwright's recorder cannot be started",
      happened: [opened, record, traceStarted, failed(reportInteractions)],
      todo: [[{ kind: "replyDeferred", result: "ignored" }, cannotStart]],
      state: {
        phase: "ended",
        outcome: {
          kind: "failed",
          reason: "Recording could not start. It broke.",
        },
      },
    },
    {
      name: "Record is answered 'ignored' and the recorder ends 'failed' when the trace cannot be started",
      happened: [opened, record, failed(startTrace)],
      todo: [[{ kind: "replyDeferred", result: "ignored" }, cannotStart]],
      state: {
        phase: "ended",
        outcome: {
          kind: "failed",
          reason: "Recording could not start. It broke.",
        },
      },
    },
    {
      name: "Record is answered 'ignored' and the recorder ends 'failed' when the pages cannot hold inputs back",
      happened: [opened, record, traceStarted, reporting, failed(holdInputs)],
      todo: [[{ kind: "replyDeferred", result: "ignored" }, cannotStart]],
      state: {
        phase: "ended",
        outcome: {
          kind: "failed",
          reason: "Recording could not start. It broke.",
        },
      },
    },
    {
      name: "Continue is answered 'ignored' and the recorder stays paused when Playwright's recorder cannot be switched on: what was recorded is kept",
      happened: [...stopped, resume, failed(reportInteractions), finish],
      todo: [
        [{ kind: "replyDeferred", result: "ignored" }],
        [reply("applied"), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "Continue is answered 'ignored' when the pages cannot hold inputs back, and what it switched on is switched off again",
      happened: [
        ...stopped,
        resume,
        reporting,
        failed(holdInputs),
        gateOff,
        reportingOff,
      ],
      todo: [
        [
          wrapUp[0]!,
          stopReporting,
          { kind: "replyDeferred", result: "ignored" },
        ],
        [],
        [],
      ],
      state: { phase: "paused" },
    },
    {
      name: "a failure to start that comes when recording has started changes nothing",
      happened: [opened, ...started, failed(reportInteractions)],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "pages that cannot confirm that they hold nothing back count as having confirmed: the wrap-up goes on",
      happened: [opened, ...started, stop, failed(wrapUp[0]!)],
      todo: [[takeSnapshot(snapshot1)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the recorder pauses also when Playwright's recorder cannot be switched off: its reports are ignored from then on",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken(snapshot1),
        failed(stopReporting),
        reported,
      ],
      todo: [[], []],
      state: { phase: "paused" },
    },
    {
      name: "a click whose 'before' cannot be taken is passed on all the same, and is not recorded (rules 1 and 2)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        failed(takeSnapshot(snapshot1)),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
        reported,
      ],
      todo: [
        [passOn(input1)],
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), letThrough(input1)],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the report of a click that could not be recorded is not taken for the next click's (rule 13)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        failed(takeSnapshot(snapshot1)),
        passedOn(input1),
        clickHeld(input2),
        taken(snapshot2),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
        reported,
        reported,
      ],
      todo: [[], [interaction(snapshot2, snapshot3, 22)]],
      state: { phase: "recording" },
    },
    {
      name: "a click whose 'after' cannot be taken keeps its 'before' only",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        reported,
        failed(takeSnapshot(snapshot2)),
      ],
      todo: [[interaction(snapshot1, null), letThrough(input1)]],
      state: { phase: "recording" },
    },
    {
      name: "a last snapshot that cannot be taken is left out: the wrap-up goes on",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        failed(takeSnapshot(snapshot1)),
      ],
      todo: [[stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "a click that cannot be passed on is dropped, and the next one of its page goes on",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        clickHeld(input2),
        taken(snapshot1),
        failed(passOn(input1)),
        reported,
      ],
      todo: [[takeSnapshot(snapshot2)], []],
      state: { phase: "recording" },
    },
    {
      name: "a wait for a Settled Page that breaks is over: the 'after' is taken",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        failed(waitForSettled(input1)),
      ],
      todo: [[takeSnapshot(snapshot2)]],
      state: { phase: "recording" },
    },
    {
      name: "a request that failed when nothing is recorded any more changes nothing",
      happened: [
        ...stopped,
        failed(takeSnapshot(snapshot1)),
        failed(passOn(input1)),
        failed(stopReporting),
        failed(wrapUp[0]!),
      ],
      todo: [[], [], [], []],
      state: { phase: "paused" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    // A row names the state it is about; what a wrap-up leads to has rows
    // of its own (ticket #1276).
    expect(result.state).toMatchObject(state);
  });

  it("saves once, however often Finish is pressed", () => {
    const { todo } = run([
      opened,
      ...started,
      finish,
      finish,
      gateOff,
      finish,
      taken(snapshot1),
      finish,
      traceStopped,
      saved,
      finish,
    ]);

    expect(todo.flat().filter((item) => item.kind === "save")).toHaveLength(1);
    expect(todo.flat().filter((item) => item.kind === "end")).toHaveLength(1);
  });
});

// Ticket #1276: what the window shows of the lifecycle. While it wraps up,
// the state says what the wrap-up leads to, and in every state it says which
// commands apply now, so that the window offers only those.
describe("what the lifecycle shows", () => {
  /** The state after these things happened, and the commands it offers. */
  const after = (happened: readonly Happening[]) => {
    let state = initialState;
    for (const happening of happened) state = step(state, happening).state;
    return { shown: shown(state), offered: offered(state) };
  };

  it.each<{ name: string; happened: Happening[]; shown: RecorderPhase }>([
    {
      name: "a wrap-up after Stop leads to a pause",
      happened: [opened, ...started, stop],
      shown: { phase: "wrappingUp", then: "pause" },
    },
    {
      name: "a wrap-up after Clear leads to clearing",
      happened: [opened, ...started, clear],
      shown: { phase: "wrappingUp", then: "clear" },
    },
    {
      name: "a wrap-up after Finish leads to saving",
      happened: [opened, ...started, finish],
      shown: { phase: "wrappingUp", then: "save" },
    },
    {
      name: "an outside end turns a wrap-up that would pause into one that saves",
      happened: [opened, ...started, stop, outsideEnd],
      shown: { phase: "wrappingUp", then: "save" },
    },
    {
      name: "an outside end leaves a wrap-up that clears clearing",
      happened: [opened, ...started, clear, outsideEnd],
      shown: { phase: "wrappingUp", then: "clear" },
    },
    // Rule 13: "recording" is shown only once a click is certain to be
    // recorded, when Record is answered. A click given before Playwright
    // reports and the pages hold inputs back is the page's alone.
    {
      name: "while Record waits for Playwright to report, it still shows not recording",
      happened: [opened, record],
      shown: { phase: "notRecording" },
    },
    {
      name: "while Record waits for the pages to hold inputs back, it still shows not recording",
      happened: [opened, record, reporting],
      shown: { phase: "notRecording" },
    },
    {
      name: "once the pages hold inputs back, Record is answered and it shows recording",
      happened: [opened, ...started],
      shown: { phase: "recording" },
    },
    {
      name: "while Continue waits for Playwright and the pages, it still shows paused",
      happened: [...stopped, resume, reporting],
      shown: { phase: "paused" },
    },
  ])("$name", ({ happened, shown }) => {
    expect(after(happened).shown).toEqual(shown);
  });

  it.each<{ name: string; happened: Happening[]; offered: string[] }>([
    { name: "no page open: nothing applies", happened: [], offered: [] },
    {
      name: "not recording, with a page open: Record",
      happened: [opened],
      offered: ["record"],
    },
    {
      name: "recording: Finish, Stop, Clear, Assert visibility and the highlight",
      happened: [opened, ...started],
      offered: [
        "finish",
        "stop",
        "clear",
        "assertVisibility",
        "highlight",
        "clearHighlight",
      ],
    },
    {
      name: "while Record waits for the pages: Finish, Stop, Clear and the highlight",
      happened: [opened, record],
      offered: ["finish", "stop", "clear", "highlight", "clearHighlight"],
    },
    {
      name: "wrapping up: nothing applies",
      happened: [opened, ...started, stop],
      offered: [],
    },
    {
      name: "paused: Finish, Continue, Clear, Discard, Restore and the highlight",
      happened: stopped,
      offered: [
        "finish",
        "continue",
        "clear",
        "discard",
        "restore",
        "highlight",
        "clearHighlight",
      ],
    },
    {
      name: "saving: nothing applies",
      happened: [...stopped, finish],
      offered: [],
    },
    {
      name: "ended: nothing applies",
      happened: [outsideEnd],
      offered: [],
    },
  ])("$name", ({ happened, offered }) => {
    expect(after(happened).offered).toEqual(offered);
  });
});

// Every kind of input: clicks of more than one count, key presses, typing,
// and the inputs Playwright reports that the gate never holds.
describe("the lifecycle, for every kind of input", () => {
  const held = (input: InputId, what: HeldInput): Happening => ({
    kind: "inputHeld",
    input,
    page: page1,
    held: what,
  });
  const clickOf = (count: number): InteractionReport => ({
    ...click,
    values: { button: "left", clickCount: count },
  });
  const enter: InteractionReport = {
    type: "press",
    selector: "internal:role=textbox",
    target: null,
    values: { key: "Enter", modifiers: 0 },
  };
  const fill = (text: string): InteractionReport => ({
    type: "fill",
    selector: "internal:role=textbox",
    target: null,
    values: { text },
  });
  const choose: InteractionReport = {
    type: "select",
    selector: "internal:role=combobox",
    target: null,
    values: { options: ["eggs"] },
  };
  const revised = (report: InteractionReport): Happening => ({
    kind: "interactionRevised",
    page: page1,
    report,
  });
  const fromReport = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: page1,
        report,
        before,
        after,
        at: 10,
        beforeFromReport: true,
      },
    },
  });
  const reportedAs = (report: InteractionReport): Happening => ({
    kind: "interactionReported",
    page: page1,
    report,
  });
  const written = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId | null,
    at = 20
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: { page: page1, report, before, after, at },
    },
  });
  /** Two clicks of one double click, from held to settled. */
  const doubleClick = [
    held(input1, { kind: "click", count: 1 }),
    held(input2, { kind: "click", count: 2 }),
    taken(snapshot1),
    passedOn(input1, 21),
    taken(snapshot2),
    passedOn(input2, 22),
    settled(input2),
    taken(snapshot3),
  ];

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    /** The phase it shows; what a wrap-up leads to may be left out. */
    state: Partial<RecorderPhase>;
  }>([
    {
      name: "one report of a double click covers both held clicks: one Interaction from the first's 'before' to the second's 'after'",
      happened: [opened, ...started, ...doubleClick, reportedAs(clickOf(2))],
      todo: [[written(clickOf(2), snapshot1, snapshot3, 21)]],
      state: { phase: "recording" },
    },
    {
      name: "a double click reported as two clicks is two Interactions",
      happened: [
        opened,
        ...started,
        ...doubleClick,
        reportedAs(clickOf(1)),
        reportedAs(clickOf(2)),
      ],
      todo: [
        [written(clickOf(1), snapshot1, snapshot2, 21)],
        [written(clickOf(2), snapshot2, snapshot3, 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the wrap-up saves a double click once its one report is in, without waiting out the time limit",
      happened: [
        opened,
        ...started,
        ...doubleClick,
        finish,
        gateOff,
        taken(snapshot4),
        reportedAs(clickOf(2)),
      ],
      todo: [
        [keep(snapshot4)],
        [written(clickOf(2), snapshot1, snapshot3, 21), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a held key press gets its 'before', is passed on, and is written down with its report",
      happened: [
        opened,
        ...started,
        held(input1, { kind: "press" }),
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
        reportedAs(enter),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), letThrough(input1)],
        [written(enter, snapshot1, snapshot2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a key press held while a click is held waits behind the click, and each report goes to its own kind of input",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        held(input2, { kind: "press" }),
        taken(snapshot1),
        passedOn(input1, 21),
        taken(snapshot2),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
        reported,
        reportedAs(enter),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [keep(snapshot1), passOn(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), passOn(input2)],
        [waitForSettled(input2)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), letThrough(input2)],
        [interaction(snapshot1, snapshot2, 21)],
        [written(enter, snapshot2, snapshot3, 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a held click whose report never comes is left out once a later input is reported: reports come in order",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        held(input2, { kind: "press" }),
        taken(snapshot1),
        passedOn(input1, 21),
        taken(snapshot2),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
        reportedAs(enter),
      ],
      todo: [[written(enter, snapshot2, snapshot3, 22)]],
      state: { phase: "recording" },
    },

    // Typing waits behind a held input.
    {
      name: "a key typed while a click is held waits: the click's 'after' is taken before the typing reaches the page, which gets no snapshot or wait of its own",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        held(input2, { kind: "typing" }),
        taken(snapshot1),
        passedOn(input1, 21),
        taken(snapshot2),
        passedOn(input2, 22),
        reported,
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [keep(snapshot1), passOn(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), passOn(input2)],
        [letThrough(input2)],
        [interaction(snapshot1, snapshot2, 21)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "keys typed one after another while held are passed on in order, with no snapshot between them",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        held(input2, { kind: "typing" }),
        held(input3, { kind: "typing" }),
        taken(snapshot1),
        passedOn(input1),
        taken(snapshot2),
        passedOn(input2),
        passedOn(input3),
      ],
      todo: [
        [keep(snapshot2), passOn(input2)],
        [passOn(input3)],
        [letThrough(input3)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "after Record a page holds what follows until its first input has a 'before': a key typed first gets one, then the page lets inputs through",
      happened: [
        opened,
        ...started,
        held(input1, { kind: "typing" }),
        taken(snapshot1),
        passedOn(input1),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [keep(snapshot1), passOn(input1)],
        [letThrough(input1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a page lets inputs through once a held click has its 'after' and nothing else is held",
      happened: [opened, ...started, ...oneClick],
      todo: [
        [takeSnapshot(snapshot1)],
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), letThrough(input1)],
      ],
      state: { phase: "recording" },
    },

    // What Playwright reports that the gate never holds.
    {
      name: "typing is written from the page's latest snapshot to its 'after' on a Settled Page, once the next input comes",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        clickHeld(input2),
      ],
      todo: [
        [waitForSettled(reported1)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [takeSnapshot(snapshot4), fromReport(fill("m"), snapshot2, snapshot3)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the wrap-up writes typing that has its 'after', at the last: it can be revised until then",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        finish,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot4)],
        [
          keep(snapshot4),
          fromReport(fill("m"), snapshot2, snapshot3),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "Playwright's revision of typing replaces its report",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        revised(fill("milk")),
        settled(reported1),
        taken(snapshot3),
        finish,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot4)],
        [
          keep(snapshot4),
          fromReport(fill("milk"), snapshot2, snapshot3),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "typing revised after its 'after' was taken waits for the page again, and ends at the newer snapshot",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        revised(fill("milk")),
        settled(reported1),
        taken(snapshot4),
        finish,
        gateOff,
        taken(snapshot5),
      ],
      todo: [
        [waitForSettled(reported1)],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot5)],
        [
          keep(snapshot5),
          fromReport(fill("milk"), snapshot2, snapshot4),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a reported select with no snapshot of its page yet gets one to start from",
      happened: [opened, ...started, reportedAs(choose), taken(snapshot1)],
      todo: [
        [takeSnapshot(snapshot1)],
        [keep(snapshot1), waitForSettled(reported1), letThrough(null)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click held while typing waits for its Settled Page closes the typing: one snapshot is the typing's 'after' and the click's 'before'",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        clickHeld(input2),
        taken(snapshot3),
      ],
      todo: [
        [waitForSettled(reported1)],
        [takeSnapshot(snapshot3)],
        [
          keep(snapshot3),
          passOn(input2),
          fromReport(fill("m"), snapshot2, snapshot3),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "typing reported after a key press was held behind it ends where the press starts, and is written before it",
      happened: [
        opened,
        ...started,
        held(input1, { kind: "typing" }),
        held(input2, { kind: "press" }),
        taken(snapshot1),
        passedOn(input1),
        reportedAs(fill("m")),
        taken(snapshot2),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
        reportedAs(enter),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [keep(snapshot1), passOn(input1)],
        [takeSnapshot(snapshot2)],
        [],
        [
          keep(snapshot2),
          passOn(input2),
          fromReport(fill("m"), snapshot1, snapshot2),
        ],
        [waitForSettled(input2)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), letThrough(input2)],
        [written(enter, snapshot2, snapshot3, 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a choice reported while the key press that made it waits for its Settled Page starts from the press's 'after'",
      happened: [
        opened,
        ...started,
        held(input1, { kind: "press" }),
        taken(snapshot1),
        passedOn(input1),
        reportedAs(choose),
        settled(input1),
        taken(snapshot2),
        settled(reported1),
        taken(snapshot3),
        finish,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), waitForSettled(reported1), letThrough(input1)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4), fromReport(choose, snapshot2, snapshot3), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a key pressed with nothing focused is written with no target, whatever element Playwright names",
      happened: [
        opened,
        ...started,
        held(input1, { kind: "press", nothingFocused: true }),
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
        reportedAs({
          ...enter,
          target: { ref: pictureRef("e1"), tree: "- generic [ref=e1]" },
        }),
      ],
      todo: [[written({ ...enter, target: null }, snapshot1, snapshot2)]],
      state: { phase: "recording" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    // A row names the state it is about; what a wrap-up leads to has rows
    // of its own (ticket #1276).
    expect(result.state).toMatchObject(state);
  });
});

// Ticket #1279: discard and restore. They are commands like the others: the
// lifecycle says whether one applies, and what it asks of the timeline. It
// knows no entry, so it cannot tell a missing one: the timeline leaves what
// it does not have alone.
describe("the lifecycle, for discard and restore", () => {
  const discard = (entry: EntryId): Happening => ({
    kind: "command",
    command: { type: "discard", entry },
  });
  const restore = (entry: EntryId): Happening => ({
    kind: "command",
    command: { type: "restore", entry },
  });
  const timelineDiscards = (entry: EntryId): ToDo => ({
    kind: "timeline",
    add: { kind: "discard", entry },
  });
  const timelineRestores = (entry: EntryId): ToDo => ({
    kind: "timeline",
    add: { kind: "restore", entry },
  });

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[];
    state: Partial<RecorderPhase>;
  }>([
    {
      name: "Discard while paused is applied, and the timeline is asked to discard the entry (rule 6)",
      happened: [...stopped, discard(interaction1)],
      todo: [timelineDiscards(interaction1), reply("applied")],
      state: { phase: "paused" },
    },
    {
      name: "Restore while paused is applied, and the timeline is asked to restore the entry (rule 6)",
      happened: [...stopped, restore(change1)],
      todo: [timelineRestores(change1), reply("applied")],
      state: { phase: "paused" },
    },
    {
      name: "Discard with nothing recorded is ignored: no recording is paused",
      happened: [opened, discard(interaction1)],
      todo: [reply("ignored")],
      state: { phase: "notRecording" },
    },
    {
      name: "Discard while recording is ignored (rule 6)",
      happened: [opened, ...started, discard(interaction1)],
      todo: [reply("ignored")],
      state: { phase: "recording" },
    },
    {
      name: "Restore while recording is ignored (rule 6)",
      happened: [opened, ...started, restore(interaction1)],
      todo: [reply("ignored")],
      state: { phase: "recording" },
    },
    {
      name: "Discard while the recorder wraps up for a pause is ignored: it is not paused yet",
      happened: [opened, ...started, stop, discard(interaction1)],
      todo: [reply("ignored")],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Discard while the package is written is ignored: review ended with Finish",
      happened: [...stopped, finish, discard(interaction1)],
      todo: [reply("ignored")],
      state: { phase: "saving" },
    },
    {
      name: "Restore after the end is ignored",
      happened: [
        ...stopped,
        finish,
        traceStopped,
        saved,
        restore(entryId("a")),
      ],
      todo: [reply("ignored")],
      state: { phase: "ended" },
    },
    {
      name: "Continue after a discard goes on as it does without one: the decision is the timeline's, and nothing is thrown away",
      happened: [...stopped, discard(interaction1), resume],
      todo: [reportInteractions, { kind: "deferReply" }],
      state: { phase: "paused" },
    },
    {
      name: "Finish after a discard saves as it does without one: the timeline writes the decisions",
      happened: [...stopped, discard(interaction1), finish],
      todo: [reply("applied"), stopTrace],
      state: { phase: "saving" },
    },
    {
      name: "Clear after a discard throws the timeline away, decisions with it (rule 5)",
      happened: [...stopped, discard(interaction1), clear, traceDiscarded],
      todo: [{ kind: "clear" }],
      state: { phase: "notRecording" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).at(-1)).toEqual(todo);
    expect(result.state).toMatchObject(state);
  });

  it("offers Discard and Restore while paused, and in no other state", () => {
    const after = (happened: readonly Happening[]) => {
      let state = initialState;
      for (const happening of happened) state = step(state, happening).state;
      return offered(state);
    };
    expect(after(stopped)).toEqual([
      "finish",
      "continue",
      "clear",
      "discard",
      "restore",
      "highlight",
      "clearHighlight",
    ]);
    expect(after([opened, ...started])).not.toContain("discard");
    expect(after([opened, ...started, stop])).not.toContain("restore");
    expect(after([...stopped, finish])).toEqual([]);
  });
});

// Follow-ups to every kind of input.
describe("the lifecycle, for a page that is blank at Record", () => {
  const blank: Happening = {
    kind: "pageOpened",
    page: page1,
    url: "about:blank",
  };

  it("starts no Visit for it, and starts its Visit, as the first, at its first real address", () => {
    const { todo, state } = run([
      blank,
      record,
      { kind: "pageNavigated", page: page1, url },
    ]);

    expect(todo.at(-2)).toEqual([startTrace, { kind: "deferReply" }]);
    expect(todo.at(-1)).toEqual([startVisit]);
    expect(state).toEqual({ phase: "notRecording" });
  });

  // As `codegen <url> --start-recording` opens it: blank at Record, and at
  // its address only once Record holds inputs back.
  const readBlank = (id: SnapshotId): Happening => ({
    kind: "snapshotTaken",
    snapshot: { ...snapshot(id), url: "about:blank", tree: "" },
  });
  const loaded: Happening = { kind: "pageNavigated", page: page1, url };
  const keyHeld = (input: InputId): Happening => ({
    kind: "inputHeld",
    input,
    page: page1,
    held: { kind: "typing" },
  });
  const fill: InteractionReport = {
    type: "fill",
    selector: "internal:role=textbox",
    target: { ref: pictureRef("e2"), tree: `- textbox "Name" [ref=e2]` },
    values: { text: "a" },
  };
  /** The "before" each fill is told to the timeline with. */
  const fillStarts = (todo: readonly (readonly ToDo[])[]) =>
    todo
      .flat()
      .flatMap((item) =>
        item.kind === "timeline" &&
        item.add.kind === "interaction" &&
        item.add.interaction.report.type === "fill"
          ? [item.add.interaction.before]
          : []
      );
  /** Once the page is loaded: a key, the read it waits for, and the fill
   * Playwright reports for it. */
  const typedOnceLoaded = (input: InputId, read: SnapshotId): Happening[] => [
    loaded,
    keyHeld(input),
    taken(read),
    passedOn(input, 30),
    { kind: "interactionReported", page: page1, report: fill },
  ];

  it("reads the loaded page for the first key typed once it is at its address, when it was read for a click while it was blank", () => {
    const { todo } = run([
      blank,
      ...started,
      clickHeld(input1),
      readBlank(snapshot1),
      passedOn(input1),
      settled(input1),
      readBlank(snapshot2),
      ...typedOnceLoaded(input2, snapshot3),
    ]);

    // The key waits for the read of the loaded page.
    expect(todo.at(-4)).toEqual([takeSnapshot(snapshot3)]);
    expect(fillStarts(todo)).toEqual([snapshot3]);
  });

  it("reads the loaded page for the first key typed once it is at its address, when Stop and Continue read it while it was blank", () => {
    const { todo } = run([
      blank,
      ...started,
      stop,
      gateOff,
      readBlank(snapshot1),
      reportingOff,
      resume,
      reporting,
      holding,
      readBlank(snapshot2),
      ...typedOnceLoaded(input1, snapshot3),
    ]);

    expect(todo.at(-4)).toEqual([takeSnapshot(snapshot3)]);
    expect(fillStarts(todo)).toEqual([snapshot3]);
  });

  it("tells the timeline nothing when it goes to its address while paused: it had no Visit to leave", () => {
    const { todo } = run([
      blank,
      ...started,
      stop,
      gateOff,
      readBlank(snapshot1),
      reportingOff,
      loaded,
    ]);

    expect(todo.at(-1)).toEqual([]);
  });

  /** Another page, at its address all along, and a read of it. */
  const other: Happening = {
    kind: "pageOpened",
    page: page2,
    url: "http://shop.test/help",
  };
  const readOther = (id: SnapshotId): Happening => ({
    kind: "snapshotTaken",
    snapshot: { ...snapshot(id), page: page2, url: "http://shop.test/help" },
  });
  const onOther = (
    input: InputId,
    held?: Extract<Happening, { kind: "inputHeld" }>["held"]
  ): Happening => ({
    kind: "inputHeld" as const,
    input,
    page: page2,
    ...(held && { held }),
  });

  it("keeps the read of another page when one goes from blank to its address: a key typed on that other page starts from it", () => {
    const { todo } = run([
      blank,
      other,
      ...started,
      onOther(input1),
      readOther(snapshot1),
      passedOn(input1),
      settledOn(page2, input1),
      readOther(snapshot2),
      loaded,
      onOther(input2, { kind: "typing" }),
    ]);

    // No read is asked for the key: the other page's latest is its start.
    expect(todo.at(-1)).not.toContainEqual(
      expect.objectContaining({
        ask: expect.objectContaining({ kind: "takeSnapshot" }),
      })
    );
  });

  it("takes a read of a page that is still blank as its read, while another page is at its address", () => {
    const { todo } = run([
      blank,
      other,
      ...started,
      clickHeld(input1),
      readBlank(snapshot1),
      passedOn(input1),
      settled(input1),
      readBlank(snapshot2),
      keyHeld(input2),
    ]);

    // The key starts from the blank page's latest read: none is asked.
    expect(todo.at(-1)).not.toContainEqual(
      expect.objectContaining({
        ask: expect.objectContaining({ kind: "takeSnapshot" }),
      })
    );
  });

  it("takes no read of the blank page that comes after the page went to its address as the page's read", () => {
    const { todo } = run([
      blank,
      ...started,
      stop,
      gateOff,
      readBlank(snapshot1),
      reportingOff,
      resume,
      reporting,
      holding,
      // The read asked at Continue comes once the page is at its address.
      loaded,
      readBlank(snapshot2),
      keyHeld(input1),
    ]);

    expect(todo.at(-1)).toEqual([takeSnapshot(snapshot3)]);
  });
});

describe("the lifecycle, for a click made while the recorder wraps up", () => {
  const clickReport = (count: number): InteractionReport => ({
    ...click,
    values: { button: "left", clickCount: count },
  });
  const reportedClick = (count: number): Happening => ({
    kind: "interactionReported",
    page: page1,
    report: clickReport(count),
  });
  /** Stop, up to Playwright's recorder being switched off. */
  const stopping = [opened, ...started, stop, gateOff, taken(snapshot1)];

  it("records a click the pages no longer held from Playwright's report alone, before the recorder is paused", () => {
    const ran = run([
      ...stopping,
      reportedClick(1),
      settled(reported1),
      taken(snapshot2),
      reportingOff,
    ]);
    const { state } = ran;

    expect(writes(ran).slice(-4)).toEqual([
      [waitForSettled(reported1)],
      [takeSnapshot(snapshot2)],
      [keep(snapshot2)],
      // Written once Playwright's recorder is off: until then Playwright
      // may still revise what it reported.
      [
        {
          kind: "timeline",
          add: {
            kind: "interaction",
            interaction: {
              page: page1,
              report: clickReport(1),
              before: snapshot1,
              after: snapshot2,
              at: 10,
              beforeFromReport: true,
            },
          },
        },
      ],
    ]);
    expect(state).toEqual({ phase: "paused" });
  });

  it("waits for such a click when Playwright's recorder is switched off before it has its 'after'", () => {
    const { todo, state } = run([
      ...stopping,
      reportedClick(1),
      reportingOff,
      settled(reported1),
      taken(snapshot2),
      reportingOff,
    ]);

    expect(todo.at(-2)).toContainEqual(stopReporting);
    expect(state).toEqual({ phase: "paused" });
  });

  it("ignores a click of count zero, which a key or a label caused", () => {
    const { todo } = run([...stopping, reportedClick(0)]);

    expect(todo.at(-1)).toEqual([]);
  });
});

describe("the lifecycle, for a warning", () => {
  const warning = {
    kind: "playwrightUnverified",
    message: "Playwright 1.99.0 is newer than the recorder is verified on.",
  } as const;

  it("passes on what the browser or the timeline warns of, whatever the phase", () => {
    expect(run([{ kind: "browserWarned", warning }]).todo).toEqual([
      [{ kind: "warn", warning }],
    ]);
    expect(
      run([opened, ...started, { kind: "timelineWarned", warning }]).todo.at(-1)
    ).toEqual([{ kind: "warn", warning }]);
  });
});

// Ticket #1278: Assert visibility. Playwright's own picking mode picks the
// element and reports the assertion; the lifecycle decides when picking
// starts and what ends it.
describe("the lifecycle, for Assert visibility", () => {
  const assertVisibility: Happening = {
    kind: "command",
    command: { type: "assertVisibility" },
  };
  const leaveAssertVisibility: Happening = {
    kind: "command",
    command: { type: "leaveAssertVisibility" },
  };
  const picking = (on: boolean): Happening => ({ kind: "picking", on });
  const pick = (on: boolean): ToDo => ({
    kind: "browser",
    ask: { kind: "pick", on },
  });
  const asserted: InteractionReport = {
    type: "assertVisible",
    selector: 'internal:role=button[name="Add"i]',
    target: null,
    values: {},
  };
  const assertionReported: Happening = {
    kind: "interactionReported",
    page: page1,
    report: asserted,
  };
  const assertion = (snapshot: SnapshotId): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: page1,
        report: asserted,
        before: snapshot,
        after: snapshot,
        at: 10,
      },
    },
  });
  const recording = [opened, ...started];
  const pickingOn = [...recording, assertVisibility, picking(true)];

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[];
    state: RecorderPhase;
  }>([
    {
      name: "Assert visibility while recording asks Playwright to pick, and shows picking only once Playwright is in its picking mode",
      happened: [...recording, assertVisibility],
      todo: [pick(true), reply("applied")],
      state: { phase: "recording" },
    },
    {
      name: "Playwright's mode change to picking shows picking, whoever switched it",
      happened: pickingOn,
      todo: [],
      state: { phase: "recording", picking: true },
    },
    {
      name: "Playwright leaving its picking mode by itself, after the pick or on Escape, ends picking, and the pages are told",
      happened: [...pickingOn, picking(false)],
      todo: [pick(false)],
      state: { phase: "recording" },
    },
    {
      name: "Leave Assert visibility while picking asks Playwright to stop picking",
      happened: [...pickingOn, leaveAssertVisibility],
      todo: [pick(false), reply("applied")],
      state: { phase: "recording" },
    },
    {
      name: "Assert visibility while picking is ignored: it is no toggle",
      happened: [...pickingOn, assertVisibility],
      todo: [reply("ignored")],
      state: { phase: "recording", picking: true },
    },
    {
      name: "Leave Assert visibility while not picking is ignored: it is no toggle",
      happened: [...recording, leaveAssertVisibility],
      todo: [reply("ignored")],
      state: { phase: "recording" },
    },
    {
      name: "Assert visibility while not recording is ignored",
      happened: [opened, assertVisibility],
      todo: [reply("ignored")],
      state: { phase: "notRecording" },
    },
    {
      name: "Assert visibility while Record waits for the pages is ignored",
      happened: [opened, record, assertVisibility],
      todo: [reply("ignored")],
      state: { phase: "notRecording" },
    },
    {
      name: "Assert visibility while paused is ignored",
      happened: [...stopped, assertVisibility],
      todo: [reply("ignored")],
      state: { phase: "paused" },
    },
    {
      name: "Assert visibility while a click is held waits: picking would swallow the click when it is passed on (rule 1)",
      happened: [...recording, clickHeld(input1), assertVisibility],
      todo: [reply("applied")],
      state: { phase: "recording" },
    },
    {
      name: "Assert visibility that waited takes effect once no input is held",
      happened: [
        ...recording,
        clickHeld(input1),
        assertVisibility,
        taken(snapshot1),
        passedOn(input1),
      ],
      todo: [waitForSettled(input1), pick(true)],
      state: { phase: "recording" },
    },
    {
      name: "Leave Assert visibility while it waits for a held input cancels it, with nothing to ask of the browser",
      happened: [
        ...recording,
        clickHeld(input1),
        assertVisibility,
        leaveAssertVisibility,
      ],
      todo: [reply("applied")],
      state: { phase: "recording" },
    },
    {
      name: "Stop while picking leaves picking as part of its wrap-up: Assert visibility is never left on (rule 3)",
      happened: [...pickingOn, stop],
      todo: [pick(false), ...wrapUp, reply("applied")],
      state: { phase: "wrappingUp", then: "pause" },
    },
    {
      name: "Finish while picking leaves picking as part of its wrap-up",
      happened: [...pickingOn, finish],
      todo: [pick(false), ...wrapUp, reply("applied")],
      state: { phase: "wrappingUp", then: "save" },
    },
    {
      name: "Clear while picking leaves picking as part of its wrap-up",
      happened: [...pickingOn, clear],
      todo: [pick(false), ...wrapUp, reply("applied")],
      state: { phase: "wrappingUp", then: "clear" },
    },
    {
      name: "an outside end while picking leaves picking as part of its wrap-up",
      happened: [...pickingOn, outsideEnd],
      todo: [pick(false), ...wrapUp],
      state: { phase: "wrappingUp", then: "save" },
    },
    {
      name: "Stop while Playwright is only asked to pick leaves picking too",
      happened: [...recording, assertVisibility, stop],
      todo: [pick(false), ...wrapUp, reply("applied")],
      state: { phase: "wrappingUp", then: "pause" },
    },
    {
      name: "Playwright entering its picking mode while the recorder wraps up is ignored: picking is being left",
      happened: [...recording, assertVisibility, stop, picking(true)],
      todo: [],
      state: { phase: "wrappingUp", then: "pause" },
    },
    {
      name: "an assertion takes one snapshot of the page as it stands",
      happened: [...pickingOn, assertionReported],
      todo: [takeSnapshot(snapshot1)],
      state: { phase: "recording", picking: true },
    },
    {
      name: "an assertion's snapshot is both its 'before' and its 'after': it never carries changes (rule 7)",
      happened: [...pickingOn, assertionReported, taken(snapshot1)],
      todo: [keep(snapshot1), assertion(snapshot1), letThrough(null)],
      state: { phase: "recording", picking: true },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).at(-1)).toEqual(todo);
    expect(result.state).toEqual(state);
  });

  it("closes an Interaction that is still settling with the assertion's snapshot: what changed after it is not the Interaction's (rule 7)", () => {
    const { todo } = run([
      ...recording,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      reported,
      assertVisibility,
      picking(true),
      assertionReported,
      taken(snapshot2),
    ]);

    expect(todo.at(-2)).toEqual([takeSnapshot(snapshot2)]);
    expect(todo.at(-1)).toEqual([
      keep(snapshot2),
      interaction(snapshot1, snapshot2),
      assertion(snapshot2),
      letThrough(input1),
    ]);
  });

  // Rule 7: a fill is measured from the page before its first key. Once a
  // page lets inputs through, a key is not held: typing straight after a
  // pick can be reported before the assertion's own read is taken.
  const filled: Happening = {
    kind: "interactionReported",
    page: page1,
    report: {
      type: "fill",
      selector: "internal:role=textbox",
      target: { ref: pictureRef("e2"), tree: `- textbox "Name" [ref=e2]` },
      values: { text: "a" },
    },
  };
  /** Each Interaction told to the timeline: its type, "before" and "after". */
  const told = (todo: readonly (readonly ToDo[])[]) =>
    todo.flat().flatMap((item) =>
      item.kind === "timeline" && item.add.kind === "interaction"
        ? [
            {
              type: item.add.interaction.report.type,
              before: item.add.interaction.before,
              after: item.add.interaction.after,
              ...(item.add.interaction.targetRead
                ? { targetRead: item.add.interaction.targetRead }
                : {}),
            },
          ]
        : []
    );
  const pickedThenTyped = [
    assertVisibility,
    picking(true),
    picking(false),
    assertionReported,
    filled,
  ];

  it("starts typing reported before an assertion's read is taken from the page's read before it, after Stop and Continue; the assertion is placed there and finds its element in its own read (rule 7)", () => {
    const { todo } = run([
      ...stopped,
      resume,
      reporting,
      holding,
      taken(snapshot2),
      ...pickedThenTyped,
      taken(snapshot3),
    ]);

    expect(told(todo)).toEqual([
      {
        type: "assertVisible",
        before: snapshot2,
        after: snapshot2,
        targetRead: snapshot3,
      },
      { type: "fill", before: snapshot2, after: null },
    ]);
  });

  it("starts typing reported before an assertion's read is taken from the page's read before it, after a click let the page through; the assertion finds its element in its own read (rule 7)", () => {
    const { todo } = run([
      ...recording,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      settled(input1),
      taken(snapshot2),
      reported,
      ...pickedThenTyped,
      taken(snapshot3),
    ]);

    expect(told(todo)).toEqual([
      { type: "click", before: snapshot1, after: snapshot2 },
      {
        type: "assertVisible",
        before: snapshot2,
        after: snapshot2,
        targetRead: snapshot3,
      },
      { type: "fill", before: snapshot2, after: null },
    ]);
  });

  it("places no assertion on a page with no read yet when typing is reported before its read: both start from that read", () => {
    const { todo } = run([...recording, ...pickedThenTyped, taken(snapshot1)]);

    expect(told(todo)).toEqual([
      { type: "assertVisible", before: snapshot1, after: snapshot1 },
      { type: "fill", before: snapshot1, after: null },
    ]);
  });

  it("places typing reported while a click's read is still being taken ahead of that click: its keys came first, and it ends where the click starts", () => {
    const { todo } = run([
      ...recording,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      settled(input1),
      taken(snapshot2),
      reported,
      clickHeld(input2),
      filled,
      taken(snapshot3),
      passedOn(input2),
      settled(input2),
      taken(snapshot4),
      reported,
    ]);

    expect(told(todo)).toEqual([
      { type: "click", before: snapshot1, after: snapshot2 },
      // Shown at once, then written with its "after".
      { type: "fill", before: snapshot2, after: null },
      { type: "fill", before: snapshot2, after: snapshot3 },
      { type: "click", before: snapshot3, after: snapshot4 },
    ]);
  });

  it("keeps an assertion's own read when it is in before typing is reported, and the typing starts from it", () => {
    const { todo } = run([
      ...recording,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      settled(input1),
      taken(snapshot2),
      reported,
      assertVisibility,
      picking(true),
      picking(false),
      assertionReported,
      taken(snapshot3),
      filled,
    ]);

    expect(told(todo)).toEqual([
      { type: "click", before: snapshot1, after: snapshot2 },
      { type: "assertVisible", before: snapshot3, after: snapshot3 },
      { type: "fill", before: snapshot3, after: null },
    ]);
  });

  it("offers Assert visibility while recording, and Leave Assert visibility while picking or waiting to", () => {
    const after = (happened: readonly Happening[]) => {
      let state = initialState;
      for (const happening of happened) state = step(state, happening).state;
      return offered(state);
    };
    expect(after(recording)).toContain("assertVisibility");
    expect(after(recording)).not.toContain("leaveAssertVisibility");
    expect(after(pickingOn)).toContain("leaveAssertVisibility");
    expect(after(pickingOn)).not.toContain("assertVisibility");
    expect(
      after([...recording, clickHeld(input1), assertVisibility])
    ).toContain("leaveAssertVisibility");
    expect(after(stopped)).not.toContain("assertVisibility");
    expect(after([opened])).not.toContain("assertVisibility");
  });
});

// Ticket #1278: hovering an entry's target in the window highlights its
// element on the page. Highlighting is a command, never an entry.
describe("the lifecycle, for the highlight", () => {
  const highlight = (entry: EntryId): Happening => ({
    kind: "command",
    command: { type: "highlight", entry },
  });
  const clearHighlight: Happening = {
    kind: "command",
    command: { type: "clearHighlight" },
  };
  const target: HighlightTarget = {
    page: page1,
    find: { by: "ref", ref: snapshotRefOf("e2") },
  };
  const located = (n: number, found = true): Happening => ({
    kind: "located",
    highlight: n,
    target: found ? target : null,
  });
  const highlighted = (n: number, found = true): Happening => ({
    kind: "highlighted",
    highlight: n,
    found,
  });
  const locate = (entry: EntryId, n: number): ToDo => ({
    kind: "locate",
    entry,
    highlight: n,
  });
  const keepReply = (n: number): ToDo => ({
    kind: "keepReply",
    key: `highlight_${n}`,
  });
  const replyKept = (
    n: number,
    result: "applied" | "ignored" | "notFound"
  ): ToDo => ({ kind: "replyKept", key: `highlight_${n}`, result });
  const draw = (n: number, drawn: typeof target | null = target): ToDo => ({
    kind: "browser",
    ask: { kind: "highlight", highlight: n, target: drawn },
  });
  const recording = [opened, ...started];

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[];
  }>([
    {
      name: "a highlight while recording keeps its answer and has the timeline find the entry's element",
      happened: [...recording, highlight(interaction1)],
      todo: [keepReply(1), locate(interaction1, 1)],
    },
    {
      name: "a highlight of a row of the entry's changes has the timeline find that row's element",
      happened: [
        ...recording,
        {
          kind: "command",
          command: { type: "highlight", entry: interaction1, row: 2 },
        },
      ],
      todo: [
        keepReply(1),
        { kind: "locate", entry: interaction1, row: 2, highlight: 1 },
      ],
    },
    {
      name: "a highlight while paused does the same: reviewing is when it is used most",
      happened: [...stopped, highlight(interaction1)],
      todo: [keepReply(1), locate(interaction1, 1)],
    },
    {
      name: "an element the timeline finds is drawn by the browser",
      happened: [...recording, highlight(interaction1), located(1)],
      todo: [draw(1)],
    },
    {
      name: "the browser drawing it answers 'applied'",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        highlighted(1),
      ],
      todo: [replyKept(1, "applied")],
    },
    {
      name: "an element the browser cannot find for certain is answered 'notFound'",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        highlighted(1, false),
      ],
      todo: [replyKept(1, "notFound")],
    },
    {
      name: "an element the timeline has no way to look for is answered 'notFound', and what was drawn is cleared",
      happened: [...recording, highlight(interaction1), located(1, false)],
      todo: [replyKept(1, "notFound"), draw(1, null)],
    },
    {
      name: "a highlight that a later one replaced is answered 'ignored'",
      happened: [
        ...recording,
        highlight(interaction1),
        highlight(interaction2),
        located(1),
      ],
      todo: [replyKept(1, "ignored")],
    },
    {
      name: "the browser's answer to a highlight that a later one replaced is 'ignored'",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        highlight(interaction2),
        highlighted(1),
      ],
      todo: [replyKept(1, "ignored")],
    },
    {
      name: "Clear highlight has the browser draw nothing, and replaces a highlight on its way",
      happened: [...recording, highlight(interaction1), clearHighlight],
      todo: [draw(2, null), reply("applied")],
    },
    // Every order of a highlight, Clear highlight, and the element being
    // found: nothing is drawn after Clear highlight, and every highlight is
    // answered.
    {
      name: "Clear highlight before the timeline found the element: the element found then is not drawn, and the highlight is answered 'ignored'",
      happened: [
        ...recording,
        highlight(interaction1),
        clearHighlight,
        located(1),
      ],
      todo: [replyKept(1, "ignored")],
    },
    {
      name: "Clear highlight before the timeline found no element: nothing more is cleared, and the highlight is answered 'ignored'",
      happened: [
        ...recording,
        highlight(interaction1),
        clearHighlight,
        located(1, false),
      ],
      todo: [replyKept(1, "ignored")],
    },
    {
      name: "Clear highlight while the browser still looks the element up: the clear is asked after the drawing, and the browser draws only the latest",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        clearHighlight,
      ],
      todo: [draw(2, null), reply("applied")],
    },
    {
      name: "the browser's answer to a highlight that Clear highlight replaced while it looked the element up is 'ignored'",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        clearHighlight,
        highlighted(1),
      ],
      todo: [replyKept(1, "ignored")],
    },
    {
      name: "Clear highlight after the browser drew it clears it",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        highlighted(1),
        clearHighlight,
      ],
      todo: [draw(2, null), reply("applied")],
    },
    {
      name: "a highlight after Clear highlight is drawn as any other",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        clearHighlight,
        highlight(interaction1),
        located(3),
      ],
      todo: [draw(3)],
    },
    {
      name: "a highlight while not recording is ignored: there is no entry",
      happened: [opened, highlight(interaction1)],
      todo: [reply("ignored")],
    },
    {
      name: "a highlight while the recorder wraps up is ignored",
      happened: [...recording, stop, highlight(interaction1)],
      todo: [reply("ignored")],
    },
    {
      name: "a highlight that is still drawn is cleared when the recording stops",
      happened: [...recording, highlight(interaction1), stop],
      todo: [...wrapUp, reply("applied"), draw(2, null)],
    },
    {
      name: "a highlight is cleared when a paused recording is saved",
      happened: [...stopped, highlight(interaction1), finish],
      todo: [reply("applied"), stopTrace, draw(2, null)],
    },
    {
      name: "the browser's answer is given whatever the recorder does meanwhile",
      happened: [
        ...stopped,
        highlight(interaction1),
        located(1),
        finish,
        highlighted(1),
      ],
      todo: [replyKept(1, "ignored")],
    },
    {
      name: "a highlight the browser could not carry out is answered 'notFound'",
      happened: [
        ...recording,
        highlight(interaction1),
        located(1),
        {
          kind: "requestFailed",
          request: { kind: "highlight", highlight: 1, target },
          reason: "It broke.",
        },
      ],
      todo: [replyKept(1, "notFound")],
    },
  ])("$name", ({ happened, todo }) => {
    expect(writes(run(happened)).at(-1)).toEqual(todo);
  });

  it("goes from Record to the trace started, to Playwright reporting, to the pages holding inputs, to Record answered, and shows recording only then", () => {
    const shownAfter = (happened: readonly Happening[]) => {
      const phases: string[] = [];
      let state = initialState;
      for (const happening of happened) {
        const next = step(state, happening);
        state = next.state;
        phases.push(shown(state).phase);
      }
      return phases;
    };
    const asks = (happening: Happening, after: readonly Happening[]) => {
      let state = initialState;
      for (const earlier of after) state = step(state, earlier).state;
      return step(state, happening).todo;
    };

    expect(
      shownAfter([opened, record, traceStarted, reporting, holding])
    ).toEqual([
      "notRecording",
      "notRecording",
      "notRecording",
      "notRecording",
      "recording",
    ]);
    // Each is asked when the one before it is answered, and no sooner.
    expect(asks(record, [opened])).toEqual([
      startVisit,
      startTrace,
      { kind: "deferReply" },
    ]);
    expect(asks(traceStarted, [opened, record])).toEqual([reportInteractions]);
    expect(asks(reporting, [opened, record, traceStarted])).toEqual([
      holdInputs,
    ]);
    expect(asks(holding, [opened, record, traceStarted, reporting])).toEqual([
      recordApplied,
    ]);
  });

  it("offers the highlight while recording and while paused", () => {
    const after = (happened: readonly Happening[]) => {
      let state = initialState;
      for (const happening of happened) state = step(state, happening).state;
      return offered(state);
    };
    expect(after(recording)).toEqual(
      expect.arrayContaining(["highlight", "clearHighlight"])
    );
    expect(after(stopped)).toEqual(
      expect.arrayContaining(["highlight", "clearHighlight"])
    );
    expect(after([opened])).toEqual(["record"]);
    expect(after([...recording, stop])).toEqual([]);
  });
});

// A choice in a dropdown and an upload show as a step as soon as
// Playwright reports them, as typing does; unlike typing, nothing revises
// them: what follows changes their rows, never their value.
describe("the lifecycle, for a choice or an upload", () => {
  const reports: InteractionReport[] = [
    {
      type: "select",
      selector: "internal:role=combobox",
      target: null,
      values: { options: ["eggs"] },
    },
    {
      type: "setInputFiles",
      selector: "internal:role=button",
      target: null,
      values: { files: ["photo.png"] },
    },
  ];

  it.each(reports)(
    "shows a $type at once, and every time it is told again it has the value it showed",
    (report) => {
      const { todo } = run([
        opened,
        ...started,
        ...oneClick,
        reported,
        { kind: "interactionReported", page: page1, report },
        { kind: "pageSettled", page: page1, input: "reported_1" as InputId },
        taken(snapshot3),
        stop,
      ]);
      const told = todo
        .flat()
        .flatMap((item) =>
          item.kind === "timeline" &&
          item.add.kind === "interaction" &&
          item.add.interaction.report.type === report.type
            ? [item.add]
            : []
        );

      // Shown before its "after", then told again with its rows.
      expect(told.map((add) => add.interaction.after)).toEqual([
        null,
        snapshot3,
      ]);
      for (const add of told) expect(add.interaction.report).toEqual(report);
    }
  );
});

// The review of the whole recorder against the spec: one row or test for
// each fault it found in the lifecycle, named by the rule it keeps.
describe("the lifecycle, for what the review against the spec found", () => {
  const reportedAs = (report: InteractionReport): Happening => ({
    kind: "interactionReported",
    page: page1,
    report,
  });
  const choose = (option: string): InteractionReport => ({
    type: "select",
    selector: `internal:role=combobox[name="${option}"]`,
    target: null,
    values: { options: [option] },
  });
  const fromReport = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: page1,
        report,
        before,
        after,
        at: 10,
        beforeFromReport: true,
      },
    },
  });
  const fill = (text: string): InteractionReport => ({
    type: "fill",
    selector: "internal:role=textbox",
    target: null,
    values: { text },
  });
  const revised = (report: InteractionReport): Happening => ({
    kind: "interactionRevised",
    page: page1,
    report,
  });
  /** A page's first snapshot since a pause, kept as such. */
  const resumesAt = (id: SnapshotId): ToDo => ({
    kind: "timeline",
    add: { kind: "snapshot", snapshot: snapshot(id), resumes: true },
  });
  const visible: InteractionReport = {
    type: "assertVisible",
    selector: "internal:role=heading",
    target: null,
    values: {},
  };

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: Partial<RecorderPhase>;
  }>([
    // Each "after" is no later than the next "before" (rule 12).
    {
      name: "a second input that is not held back, reported while the first waits for its Settled Page, closes the first: one snapshot is the first's 'after' and the second's 'before' (rule 12)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(choose("milk")),
        reportedAs(choose("eggs")),
        taken(snapshot3),
        // The wait that was cut short ends later: nothing more is asked.
        settled(reported1),
        settled(reported2),
        taken(snapshot4),
        finish,
        gateOff,
        taken(snapshot5),
      ],
      todo: [
        [waitForSettled(reported1)],
        [takeSnapshot(snapshot3)],
        [
          keep(snapshot3),
          waitForSettled(reported2),
          fromReport(choose("milk"), snapshot2, snapshot3),
        ],
        [],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot5)],
        [
          keep(snapshot5),
          fromReport(choose("eggs"), snapshot3, snapshot4),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a second input that is not held back, reported while the first's 'after' is being taken, starts at that snapshot, and what revised the first gets no further wait (rule 12)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(choose("milk")),
        settled(reported1),
        {
          kind: "interactionRevised",
          page: page1,
          report: choose("bread"),
        },
        reportedAs(choose("eggs")),
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [],
        [],
        [
          keep(snapshot3),
          waitForSettled(reported2),
          fromReport(choose("bread"), snapshot2, snapshot3),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      // The assertion's read is taken after the input: starting there would
      // leave out what the input did itself (rule 7).
      name: "an input that is not held back, reported while an assertion's snapshot is being taken, starts at the page's read before it, where the assertion is written too, in time order (rules 7 and 12)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(visible),
        reportedAs(choose("eggs")),
        taken(snapshot3),
        settled(reported2),
        taken(snapshot4),
        finish,
        gateOff,
        taken(snapshot5),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        // The choice starts at the read before it; its wait for a Settled
        // Page comes once nothing ahead of it is under way.
        [],
        // The read taken for the assertion is where it finds its element.
        [
          keep(snapshot3),
          waitForSettled(reported2),
          {
            kind: "timeline",
            add: {
              kind: "interaction",
              interaction: {
                page: page1,
                report: visible,
                before: snapshot2,
                after: snapshot2,
                at: 10,
                targetRead: snapshot3,
              },
            },
          },
        ],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot5)],
        [
          keep(snapshot5),
          fromReport(choose("eggs"), snapshot2, snapshot4),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },

    // "Paused" on screen is the moment recording ends (rule 13).
    {
      name: "typing that is revised while the recorder wraps up is written as revised: it is written only once Playwright's recorder is off (rule 13)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        stop,
        revised(fill("milk")),
        gateOff,
        settled(reported1),
        taken(snapshot4),
        taken(snapshot5),
        reportingOff,
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [waitForSettled(reported1)],
        [],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4), takeSnapshot(snapshot5)],
        [keep(snapshot5), stopReporting],
        [fromReport(fill("milk"), snapshot2, snapshot4)],
      ],
      state: { phase: "paused" },
    },
    {
      name: "typing that is revised while Playwright's recorder is being switched off is written as revised (rule 13)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        stop,
        gateOff,
        taken(snapshot4),
        revised(fill("milk")),
        reportingOff,
        settled(reported1),
        taken(snapshot5),
        reportingOff,
      ],
      todo: [
        [keep(snapshot4), stopReporting],
        [waitForSettled(reported1)],
        [],
        [takeSnapshot(snapshot5)],
        [keep(snapshot5), stopReporting],
        [fromReport(fill("milk"), snapshot2, snapshot5)],
      ],
      state: { phase: "paused" },
    },
    {
      name: "typing that is revised after Finish was pressed is saved as revised (rules 4 and 13)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        finish,
        revised(fill("milk")),
        gateOff,
        settled(reported1),
        taken(snapshot4),
        taken(snapshot5),
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [waitForSettled(reported1)],
        [],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4), takeSnapshot(snapshot5)],
        [
          keep(snapshot5),
          fromReport(fill("milk"), snapshot2, snapshot4),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "when the time limit passes, typing that waited to be revised is written all the same",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        stop,
        { kind: "timeLimitPassed" },
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [fromReport(fill("m"), snapshot2, snapshot3), stopReporting],
      ],
      state: { phase: "paused" },
    },

    // Nothing done while not recording appears (rule 13): what the page
    // changed while paused is left out.
    {
      name: "Continue has each page read once the pages hold inputs back: where recording resumes is the new point to compare from (rule 13)",
      happened: [...stopped, resume, reporting, holding, taken(snapshot2)],
      todo: [
        [holdInputs],
        [recordApplied, takeSnapshot(snapshot2)],
        [resumesAt(snapshot2), letThrough(null)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "only a page's first snapshot after Continue is where recording resumes: a click held before it is in gets its own 'before', and whichever comes first is the one (rule 13)",
      happened: [
        ...stopped,
        resume,
        reporting,
        holding,
        clickHeld(input1),
        taken(snapshot3),
        taken(snapshot2),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [resumesAt(snapshot3), passOn(input1)],
        [keep(snapshot2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Stop pressed before the page is read after Continue: the last snapshot is where recording resumed, and nothing waits for the other (rule 13)",
      happened: [
        ...stopped,
        resume,
        reporting,
        holding,
        stop,
        gateOff,
        taken(snapshot3),
        reportingOff,
        taken(snapshot2),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [resumesAt(snapshot3), stopReporting],
        [],
        [],
      ],
      state: { phase: "paused" },
    },

    // Input reaches the page in the order the person gave it (rule 11).
    // The page's part is in the compatibility suite: it goes
    // on holding a click while an input it held still waits. This is the
    // lifecycle's part.
    {
      name: "a click a page held back after it stopped holding inputs, behind a click and a key that still wait, is passed on after both (rule 11)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        {
          kind: "inputHeld",
          input: input2,
          page: page1,
          held: { kind: "typing" },
        },
        stop,
        gateOff,
        clickHeld(input3),
        taken(snapshot1),
        passedOn(input1),
        taken(snapshot2),
        passedOn(input2),
        taken(snapshot3),
      ],
      todo: [
        [],
        [],
        [keep(snapshot1), passOn(input1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), passOn(input2)],
        // The key keeps the pages holding until its page settles (bug 7);
        // the click behind it does not wait for that.
        [waitForSettled(input2), takeSnapshot(snapshot3)],
        [keep(snapshot3), passOn(input3)],
      ],
      state: { phase: "wrappingUp" },
    },

    {
      name: "a key typed before Stop needs no read of its own once its page settles in the wrap-up: its report says what it changed",
      happened: [
        opened,
        ...started,
        {
          kind: "inputHeld",
          input: input1,
          page: page1,
          held: { kind: "typing" },
        },
        stop,
        gateOff,
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
      ],
      todo: [
        [keep(snapshot1), passOn(input1)],
        [waitForSettled(input1)],
        // Settled with no read: the wrap-up goes on to its final read.
        [holdNoMore, takeSnapshot(snapshot2)],
      ],
      state: { phase: "wrappingUp" },
    },

    // The change analysis of the branch: behaviour no row pinned.
    {
      name: "a report of a kind the recorder does not record is ignored, while recording and while wrapping up",
      happened: [
        opened,
        ...started,
        reportedAs({ ...fill("x"), type: "navigate" }),
        stop,
        gateOff,
        reportedAs({ ...fill("x"), type: "openPage" }),
      ],
      todo: [[], [...wrapUp, reply("applied")], [takeSnapshot(snapshot1)], []],
      state: { phase: "wrappingUp" },
    },
    {
      name: "an assertion reported before the report of a click made ahead of it is written after that click: entries keep the order of the inputs",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reportedAs(visible),
        taken(snapshot3),
        reported,
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [
          interaction(snapshot1, snapshot2),
          {
            kind: "timeline",
            add: {
              kind: "interaction",
              interaction: {
                page: page1,
                report: visible,
                before: snapshot3,
                after: snapshot3,
                at: 10,
              },
            },
          },
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "typing that waited to be revised is written when the last page closes: with no page left there is no last snapshot to wait for",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        { kind: "pageClosed", page: page1, pagesLeft: 0 },
        gateOff,
      ],
      todo: [wrapUp, [fromReport(fill("m"), snapshot2, snapshot3), stopTrace]],
      state: { phase: "saving" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    expect(result.state).toMatchObject(state);
  });
});

// An end from outside always finishes: stopping the trace is given a time,
// and that time is one stop's own.
describe("the lifecycle, for the time an answer is given", () => {
  /** Where the lifecycle stands after these things happened. */
  const after = (happened: readonly Happening[]) =>
    happened.reduce(
      (state, happening) => step(state, happening).state,
      initialState
    );
  const askOf = (todo: ToDo) => {
    if (todo.kind !== "browser") throw new Error("Not a request.");
    return todo.ask;
  };
  const saving = [...stopped, finish];
  const discarding = [...stopped, clear];

  it.each<{ name: string; happened: Happening[]; of: ToDo; awaited: boolean }>([
    {
      name: "a save waits for its trace to be stopped",
      happened: saving,
      of: stopTrace,
      awaited: true,
    },
    {
      name: "a save that has its trace waits for it no more",
      happened: [...saving, traceStopped],
      of: stopTrace,
      awaited: false,
    },
    {
      name: "a save does not wait for a trace to be thrown away",
      happened: saving,
      of: discardTrace,
      awaited: false,
    },
    {
      name: "a Clear waits for its trace to be gone",
      happened: discarding,
      of: discardTrace,
      awaited: true,
    },
    {
      name: "a Clear whose trace is gone waits for it no more, also once Record is pressed again",
      happened: [...discarding, { kind: "traceDiscarded" }, record],
      of: discardTrace,
      awaited: false,
    },
    {
      name: "no other request's answer is given a time",
      happened: [opened, ...started, stop],
      of: wrapUp[0]!,
      awaited: false,
    },
    {
      name: "a Clear that waits for its trace waits for no other request's answer",
      happened: discarding,
      of: wrapUp[0]!,
      awaited: false,
    },
    {
      name: "a Clear does not wait for a trace to be kept",
      happened: discarding,
      of: stopTrace,
      awaited: false,
    },
  ])("$name", ({ happened, of, awaited }) => {
    expect(awaitsAnswer(after(happened), askOf(of))).toBe(awaited);
  });

  it("writes the package without its trace when the stop was not answered in time, as when it broke", () => {
    const { todo, state } = run([...saving, failed(stopTrace)]);

    expect(todo.at(-1)).toEqual([{ kind: "save" }]);
    expect(state).toEqual({ phase: "saving" });
  });

  it("is over with a cleared recording when its trace was not gone in time, as when it broke", () => {
    const { todo, state } = run([...discarding, failed(discardTrace)]);

    expect(todo.at(-1)).toEqual([{ kind: "clear" }]);
    expect(state).toEqual({ phase: "notRecording" });
  });
});

// The change analysis of the branch: what the highlight does when the
// recorder leaves recording and pausing.
describe("the lifecycle, for a highlight that the recorder leaves behind", () => {
  const highlight: Happening = {
    kind: "command",
    command: { type: "highlight", entry: interaction1 },
  };

  it("clears no highlight when the recorder ends at once: its browser is let go", () => {
    const { todo, state } = run([
      opened,
      ...started,
      highlight,
      { kind: "brokeDown", reason: "It broke." },
    ]);

    expect(todo.at(-1)).toEqual([
      { kind: "end", outcome: { kind: "failed", reason: "It broke." } },
    ]);
    expect(state.phase).toBe("ended");
  });

  it("numbers the next highlight after the one that cleared the last: an answer to an older one is not taken for it", () => {
    const { todo } = run([
      ...stopped.slice(0, 5),
      highlight,
      ...stopped.slice(5),
      highlight,
    ]);

    // The first highlight, the clearing as the recorder left recording, and
    // this one.
    expect(todo.at(-1)).toEqual([
      { kind: "keepReply", key: "highlight_3" },
      { kind: "locate", entry: interaction1, highlight: 3 },
    ]);
  });
});

// The change analysis of the branch: rows for more than one page, which no
// row had, and for what is told when nothing waits for it.
// Shared by the lifecycle's tests of pages, inputs and their snapshots.
const takenOf = (id: SnapshotId, page: PageId): Happening => ({
  kind: "snapshotTaken",
  snapshot: { ...snapshot(id), page },
});
const snap = (id: SnapshotId, page: PageId): ToDo => ({
  kind: "browser",
  ask: { kind: "takeSnapshot", snapshot: id, page },
});
const kept = (id: SnapshotId, page: PageId): ToDo => ({
  kind: "timeline",
  add: { kind: "snapshot", snapshot: { ...snapshot(id), page } },
});
const settledOn = (page: PageId, input: InputId): Happening => ({
  kind: "pageSettled",
  page,
  input,
});
const waitOn = (page: PageId, input: InputId): ToDo => ({
  kind: "browser",
  ask: { kind: "waitForSettled", page, input },
});
const through = (page: PageId, upTo: InputId | null): ToDo => ({
  kind: "browser",
  ask: { kind: "letInputsThrough", page, upTo },
});
const typed = (text: string): InteractionReport => ({
  type: "fill",
  selector: "internal:role=textbox",
  target: null,
  values: { text },
});

describe("the lifecycle, with more than one page", () => {
  const url2 = "http://shop.test/help";
  const BLANK = "about:blank";
  const opened2: Happening = {
    kind: "pageOpened",
    page: page2,
    url: url2,
  };
  const blank = (page: PageId): Happening => ({
    kind: "pageOpened",
    page,
    url: BLANK,
  });
  const closed2: Happening = {
    kind: "pageClosed",
    page: page2,
    pagesLeft: 1,
  };
  const heldOn = (
    page: PageId,
    input: InputId,
    held?: HeldInput
  ): Happening => ({
    kind: "inputHeld",
    input,
    page,
    ...(held ? { held } : {}),
  });
  const snapshotOf = (id: SnapshotId, page: PageId): PageSnapshot => ({
    ...snapshot(id),
    page,
  });
  const choice: InteractionReport = {
    type: "select",
    selector: "internal:role=combobox",
    target: null,
    values: { options: ["eggs"] },
  };

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: Partial<RecorderPhase>;
  }>([
    // Visits.
    {
      name: "Record starts a Visit for every page at an address: the first is 'initial', the others 'openPage'",
      happened: [opened, opened2, record],
      todo: [
        [
          visitAt(url, "initial"),
          visitAt(url2, "openPage", page2),
          startTrace,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "notRecording" },
    },
    {
      name: "a page that is blank at Record beside one at an address is not the first: its Visit is 'openPage' when it goes somewhere",
      happened: [blank(page1), opened2, ...started, navigated(url)],
      todo: [
        [visitAt(url2, "initial", page2), startTrace, { kind: "deferReply" }],
        [reportInteractions],
        [holdInputs],
        [recordApplied],
        [visitAt(url, "openPage")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "of two pages that are blank at Record, the first one's Visit is 'initial' whenever it comes, and the other's 'openPage'",
      happened: [
        blank(page1),
        blank(page2),
        ...started,
        navigated(url2, page2),
        navigated(url),
      ],
      todo: [[visitAt(url2, "openPage", page2)], [visitAt(url, "initial")]],
      state: { phase: "recording" },
    },
    {
      name: "Continue starts no Visit for a page that opened while paused and is still blank",
      happened: [...stopped, blank(page2), resume],
      todo: [[reportInteractions, { kind: "deferReply" }]],
      state: { phase: "paused" },
    },
    {
      name: "a page the recorder does not know of that goes somewhere while recording starts no Visit",
      happened: [opened, ...started, navigated(url2, page9)],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a page that goes blank while recording starts no Visit there, and one by navigation where it goes next",
      happened: [opened, ...started, navigated(BLANK), navigated(url2)],
      todo: [[], [visitAt(url2, "navigate")]],
      state: { phase: "recording" },
    },
    {
      name: "a page that goes elsewhere stays the page it is: the wrap-up reads each open page once",
      happened: [
        opened,
        opened2,
        ...started,
        navigated(`${url}cart`),
        finish,
        gateOff,
      ],
      todo: [[snap(snapshot1, page1), snap(snapshot2, page2)]],
      state: { phase: "wrappingUp" },
    },

    // A page that closes while another stays open.
    {
      name: "a click held on a page that stays open goes on when another page closes",
      happened: [
        opened,
        opened2,
        ...started,
        heldOn(page1, input1),
        closed2,
        takenOf(snapshot1, page1),
      ],
      todo: [
        [snap(snapshot1, page1)],
        [],
        [kept(snapshot1, page1), passOn(input1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a page that closed is not read at the end: the wrap-up reads the pages that are left",
      happened: [opened, opened2, ...started, closed2, finish, gateOff],
      todo: [[snap(snapshot1, page1)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a page that closes while the wrap-up waits for its last snapshot is waited for no more",
      happened: [
        opened,
        opened2,
        ...started,
        finish,
        gateOff,
        closed2,
        takenOf(snapshot1, page1),
      ],
      todo: [
        [snap(snapshot1, page1), snap(snapshot2, page2)],
        [],
        [kept(snapshot1, page1), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a page that closes after Continue is waited for no more: its snapshot is not kept, and the other page's is where recording resumes",
      happened: [
        opened,
        opened2,
        ...started,
        stop,
        gateOff,
        takenOf(snapshot1, page1),
        takenOf(snapshot2, page2),
        reportingOff,
        resume,
        reporting,
        holding,
        closed2,
        takenOf(snapshot4, page2),
        takenOf(snapshot3, page1),
      ],
      todo: [
        [recordApplied, snap(snapshot3, page1), snap(snapshot4, page2)],
        [],
        [],
        [
          {
            kind: "timeline",
            add: {
              kind: "snapshot",
              snapshot: snapshotOf(snapshot3, page1),
              resumes: true,
            },
          },
          through(page1, null),
        ],
      ],
      state: { phase: "recording" },
    },

    // Each page has a gate of its own.
    {
      name: "a click on a page that opened while recording is recorded there, and that page is let through after it",
      happened: [
        opened,
        ...started,
        opened2,
        heldOn(page2, input1),
        takenOf(snapshot1, page2),
        passedOn(input1),
        settledOn(page2, input1),
        takenOf(snapshot2, page2),
      ],
      todo: [
        [visitAt(url2, "openPage", page2)],
        [snap(snapshot1, page2)],
        [kept(snapshot1, page2), passOn(input1)],
        [waitOn(page2, input1)],
        [snap(snapshot2, page2)],
        [kept(snapshot2, page2), through(page2, input1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a choice reported on a page that opened while recording gets a snapshot to start from; that page held nothing, so nothing is let through",
      happened: [
        opened,
        ...started,
        opened2,
        { kind: "interactionReported", page: page2, report: choice },
        takenOf(snapshot1, page2),
      ],
      todo: [
        [snap(snapshot1, page2)],
        [kept(snapshot1, page2), waitOn(page2, reported1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "of two pages open at Record, only the one a click was made on is let through after it",
      happened: [
        opened,
        opened2,
        ...started,
        heldOn(page2, input1),
        takenOf(snapshot1, page2),
        passedOn(input1),
        settledOn(page2, input1),
        takenOf(snapshot2, page2),
      ],
      todo: [[kept(snapshot2, page2), through(page2, input1)]],
      state: { phase: "recording" },
    },
    {
      name: "typing held on a page that has no snapshot yet gets one of its own, whatever another page has",
      happened: [
        opened,
        opened2,
        ...started,
        ...oneClick,
        heldOn(page2, input2, { kind: "typing" }),
      ],
      todo: [[snap(snapshot3, page2)]],
      state: { phase: "recording" },
    },

    // What one page does is not another's.
    {
      name: "a click held on one page does not close an Interaction that settles on another",
      happened: [
        opened,
        opened2,
        ...started,
        heldOn(page1, input1),
        takenOf(snapshot1, page1),
        passedOn(input1),
        heldOn(page2, input2),
      ],
      todo: [[snap(snapshot2, page2)]],
      state: { phase: "recording" },
    },
    {
      name: "the wrap-up waits for the last snapshot of every page",
      happened: [
        opened,
        opened2,
        ...started,
        finish,
        gateOff,
        takenOf(snapshot1, page1),
      ],
      todo: [[kept(snapshot1, page1)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "an input that reached its page is known by itself, whatever is on its way on another page",
      happened: [
        opened,
        opened2,
        ...started,
        heldOn(page1, input1),
        heldOn(page2, input2),
        takenOf(snapshot1, page1),
        takenOf(snapshot2, page2),
        passedOn(input2),
      ],
      todo: [[waitOn(page2, input2)]],
      state: { phase: "recording" },
    },
    {
      name: "an input that reached its page shares no snapshot with one that waits on another page",
      happened: [
        opened,
        opened2,
        ...started,
        heldOn(page1, input1),
        heldOn(page2, input2),
        heldOn(page2, input3),
        takenOf(snapshot1, page1),
        passedOn(input1),
      ],
      todo: [[waitOn(page1, input1)]],
      state: { phase: "recording" },
    },
    {
      name: "a report goes to the click of its own page, and gives up on no click of another",
      happened: [
        opened,
        opened2,
        ...started,
        heldOn(page1, input1),
        takenOf(snapshot1, page1),
        passedOn(input1),
        settledOn(page1, input1),
        takenOf(snapshot2, page1),
        heldOn(page2, input2),
        takenOf(snapshot3, page2),
        passedOn(input2, 22),
        settledOn(page2, input2),
        takenOf(snapshot4, page2),
        { kind: "interactionReported", page: page2, report: click },
        reported,
      ],
      todo: [
        [
          {
            kind: "timeline",
            add: {
              kind: "interaction",
              interaction: {
                page: page2,
                report: click,
                before: snapshot3,
                after: snapshot4,
                at: 22,
              },
            },
          },
        ],
        [interaction(snapshot1, snapshot2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Playwright's revision on one page does not revise what was typed on another",
      happened: [
        opened,
        opened2,
        ...started,
        {
          kind: "interactionReported",
          page: page1,
          report: typed("m"),
        },
        takenOf(snapshot1, page1),
        // Page 2 had a report of its own since Record: its revision is of
        // that one, not of a fill from before Record.
        {
          kind: "interactionReported",
          page: page2,
          report: {
            type: "click",
            selector: "internal:role=button",
            target: null,
            values: { button: "left" },
          },
        },
        {
          kind: "interactionRevised",
          page: page2,
          report: typed("x"),
        },
        settledOn(page1, reported1),
        takenOf(snapshot2, page1),
        finish,
        gateOff,
        takenOf(snapshot3, page1),
        takenOf(snapshot4, page2),
      ],
      todo: [
        [
          kept(snapshot4, page2),
          {
            kind: "timeline",
            add: {
              kind: "interaction",
              interaction: {
                page: page1,
                report: typed("m"),
                before: snapshot1,
                after: snapshot2,
                at: 10,
                beforeFromReport: true,
              },
            },
          },
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },

    // Told when nothing waits for it.
    {
      name: "a save that is told done when none was under way changes nothing",
      happened: [opened, saved],
      todo: [[]],
      state: { phase: "notRecording" },
    },
    {
      name: "a click a page held back once the recorder has ended is asked of nobody: its browser is let go",
      happened: [outsideEnd, clickHeld(input1)],
      todo: [[]],
      state: { phase: "ended" },
    },
    {
      name: "a trace told stopped, or gone, when none was asked to stop changes nothing",
      happened: [opened, traceStopped, traceDiscarded],
      todo: [[], []],
      state: { phase: "notRecording" },
    },
    {
      name: "a trace told gone during a wrap-up that throws nothing away changes nothing",
      happened: [opened, ...started, stop, traceDiscarded, traceStopped],
      todo: [[], []],
      state: { phase: "wrappingUp" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    expect(result.state).toMatchObject(state);
  });

  /** Each Interaction told to the timeline, by its page and type. */
  const toldOf = (todo: readonly (readonly ToDo[])[]) =>
    todo
      .flat()
      .flatMap((item) =>
        item.kind === "timeline" && item.add.kind === "interaction"
          ? [`${item.add.interaction.page} ${item.add.interaction.report.type}`]
          : []
      );
  const choiceOn2: Happening = {
    kind: "interactionReported",
    page: page2,
    report: {
      type: "select",
      selector: "internal:role=combobox",
      target: null,
      values: { options: ["Large"] },
    },
  };

  it("writes an input of one page while another page's input is still under way: entries keep the order of each page's inputs only", () => {
    const { todo } = run([
      opened,
      opened2,
      ...started,
      clickHeld(input1),
      takenOf(snapshot1, page1),
      passedOn(input1),
      choiceOn2,
      takenOf(snapshot2, page2),
      settledOn(page2, reported1),
      takenOf(snapshot3, page2),
    ]);

    // Shown once reported, and written with its "after".
    expect(toldOf(todo)).toEqual(["page_2 select", "page_2 select"]);
  });

  it("sets the text of a fill made final while another page's click has its report: a report on another page is not newer than the fill", () => {
    const fillOn1 = (text: string) => ({
      type: "fill",
      selector: "internal:role=textbox",
      target: null,
      values: { text },
    });
    const { todo } = run([
      opened,
      opened2,
      ...started,
      { kind: "interactionReported", page: page1, report: fillOn1("m") },
      takenOf(snapshot1, page1),
      settledOn(page1, reported1),
      takenOf(snapshot2, page1),
      { kind: "inputHeld", input: input2, page: page2 },
      takenOf(snapshot3, page2),
      passedOn(input2),
      {
        kind: "interactionReported",
        page: page2,
        report: { ...click, values: { button: "left", clickCount: 1 } },
      },
      // The next input on the fill's page makes the fill final.
      clickHeld(input3),
      { kind: "interactionRevised", page: page1, report: fillOn1("mi") },
    ]);

    expect(todo.at(-1)).toEqual([
      {
        kind: "timeline",
        add: { kind: "text", key: expect.any(String), report: fillOn1("mi") },
      },
    ]);
  });

  it("takes no revision Playwright reports for a page that closed", () => {
    const { todo } = run([
      opened,
      opened2,
      ...started,
      { kind: "pageClosed", page: page2, pagesLeft: 1 },
      { kind: "interactionRevised", page: page2, report: typed("x") },
    ]);

    expect(todo.at(-1)).toEqual([]);
  });

  it("writes an input of one page while another page's click waits for its report", () => {
    const { todo } = run([
      opened,
      opened2,
      ...started,
      clickHeld(input1),
      takenOf(snapshot1, page1),
      passedOn(input1),
      settledOn(page1, input1),
      takenOf(snapshot2, page1),
      choiceOn2,
      takenOf(snapshot3, page2),
      settledOn(page2, reported1),
      takenOf(snapshot4, page2),
    ]);

    // Shown once reported, and written with its "after".
    expect(toldOf(todo)).toEqual(["page_2 select", "page_2 select"]);
  });
});

// The change analysis of the branch: Assert visibility around a pause.
describe("the lifecycle, for Assert visibility that is left or resumed", () => {
  const assert: Happening = {
    kind: "command",
    command: { type: "assertVisibility" },
  };
  const leave: Happening = {
    kind: "command",
    command: { type: "leaveAssertVisibility" },
  };
  const pick: ToDo = { kind: "browser", ask: { kind: "pick", on: true } };

  it.each<{ name: string; happened: Happening[]; todo: ToDo[][] }>([
    {
      name: "Leave Assert visibility is ignored while Assert visibility is off",
      happened: [opened, ...started, leave],
      todo: [[reply("ignored")]],
    },
    {
      name: "Assert visibility applies again once it was left",
      happened: [opened, ...started, assert, leave, assert],
      todo: [[pick, reply("applied")]],
    },
    {
      name: "Assert visibility applies after Continue: a pause leaves it off",
      happened: [...stopped, resume, reporting, holding, assert],
      todo: [[pick, reply("applied")]],
    },
  ])("$name", ({ happened, todo }) => {
    expect(writes(run(happened)).slice(-todo.length)).toEqual(todo);
  });
});

// The change analysis of the branch: what is told a second time, or when
// its turn is over, changes nothing.
describe("the lifecycle, for what is told twice or out of turn", () => {
  const reportedAs = (report: InteractionReport): Happening => ({
    kind: "interactionReported",
    page: page1,
    report,
  });
  const revised = (report: InteractionReport): Happening => ({
    kind: "interactionRevised",
    page: page1,
    report,
  });
  const fromReport = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: page1,
        report,
        before,
        after,
        at: 10,
        beforeFromReport: true,
      },
    },
  });
  /** A click that reached its page and waits for its Settled Page. */
  const clickSettling = [clickHeld(input1), taken(snapshot1), passedOn(input1)];

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: Partial<RecorderPhase>;
  }>([
    // Starting.
    {
      name: "a trace told started a second time asks for nothing more",
      happened: [opened, ...started, traceStarted],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "Playwright told reporting again while recording asks for nothing more",
      happened: [opened, ...started, reporting],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "Playwright told not reporting while Record waits does not go on to the pages",
      happened: [opened, record, traceStarted, reportingOff],
      todo: [[]],
      state: { phase: "notRecording" },
    },
    {
      name: "pages that tell they hold nothing back while Record waits do not answer it",
      happened: [opened, record, traceStarted, reporting, gateOff],
      todo: [[]],
      state: { phase: "notRecording" },
    },
    {
      name: "pages that confirm again once recording answer nothing a second time",
      happened: [opened, ...started, holding],
      todo: [[]],
      state: { phase: "recording" },
    },

    // Wrapping up.
    {
      name: "pages that tell they hold inputs back during a wrap-up have confirmed nothing: no last snapshot is taken",
      happened: [opened, ...started, stop, holding],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Playwright told reporting while it is being switched off has confirmed nothing: the recorder is not paused",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken(snapshot1),
        reporting,
      ],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "when the time limit passes while one snapshot is taken for two clicks, the one that still waits is passed on (rule 1)",
      happened: [
        opened,
        ...started,
        ...clickSettling,
        clickHeld(input2),
        stop,
        { kind: "timeLimitPassed" },
      ],
      todo: [
        [takeSnapshot(snapshot2)],
        [startTimeLimit, reply("applied")],
        [holdNoMore, passOn(input2), stopReporting],
      ],
      state: { phase: "paused" },
    },

    // A held input.
    {
      name: "an input told passed on a second time is not waited for twice",
      happened: [opened, ...started, ...clickSettling, passedOn(input1)],
      todo: [[waitForSettled(input1)], []],
      state: { phase: "recording" },
    },
    {
      name: "an input the recorder does not know of that is told passed on changes nothing",
      happened: [opened, ...started, passedOn(input9)],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a click told gone after it reached its page is recorded all the same",
      happened: [
        opened,
        ...started,
        ...clickSettling,
        { kind: "inputGone", input: input1 },
        settled(input1),
        taken(snapshot2),
        reported,
      ],
      todo: [[interaction(snapshot1, snapshot2)]],
      state: { phase: "recording" },
    },
    {
      name: "a second report of a click, while the click that has its report still settles, replaces nothing",
      happened: [
        opened,
        ...started,
        ...clickSettling,
        reported,
        reportedAs({ ...click, selector: "internal:role=link" }),
        settled(input1),
        taken(snapshot2),
      ],
      todo: [
        [
          keep(snapshot2),
          interaction(snapshot1, snapshot2),
          letThrough(input1),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Playwright's revision of a held click's report replaces nothing: only what the gate never holds is revised",
      happened: [
        opened,
        ...started,
        ...clickSettling,
        reported,
        revised({ ...click, selector: "internal:role=link" }),
        settled(input1),
        taken(snapshot2),
      ],
      todo: [
        [
          keep(snapshot2),
          interaction(snapshot1, snapshot2),
          letThrough(input1),
        ],
      ],
      state: { phase: "recording" },
    },

    // Where an input that is not held back starts and ends.
    {
      name: "a choice reported while typing waits for its 'before' does not end at the typing's snapshot: typing is not where an Interaction ends",
      happened: [
        opened,
        ...started,
        {
          kind: "inputHeld",
          input: input1,
          page: page1,
          held: { kind: "typing" },
        },
        reportedAs({ ...typed("x"), type: "select" }),
        taken(snapshot2),
        taken(snapshot1),
        settled(reported1),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), waitForSettled(reported1)],
        [keep(snapshot1), passOn(input1)],
        [takeSnapshot(snapshot3)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "typing reported while a click's 'before' is being taken ends at that snapshot, and is written before the click",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        clickHeld(input2),
        reportedAs(typed("m")),
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [],
        [
          keep(snapshot3),
          passOn(input2),
          fromReport(typed("m"), snapshot2, snapshot3),
        ],
      ],
      state: { phase: "recording" },
    },

    // What Playwright revises.
    {
      name: "a revision with nothing reported to revise since Record changes nothing",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        revised(typed("x")),
      ],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a revision of another kind than what was reported last revises nothing",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(typed("m")),
        revised({ ...typed("x"), type: "select" }),
        settled(reported1),
        taken(snapshot3),
        finish,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [
          keep(snapshot4),
          fromReport(typed("m"), snapshot2, snapshot3),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "typing revised while its 'after' is being taken is given time again: its 'after' is the later snapshot",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(typed("m")),
        settled(reported1),
        revised(typed("milk")),
        taken(snapshot3),
        settled(reported1),
        taken(snapshot4),
        finish,
        gateOff,
        taken(snapshot5),
      ],
      todo: [
        [],
        [keep(snapshot3), waitForSettled(reported1)],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot5)],
        [
          keep(snapshot5),
          fromReport(typed("milk"), snapshot2, snapshot4),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    expect(result.state).toMatchObject(state);
  });
});

// The change analysis of the branch: which held clicks one report covers.
describe("the lifecycle, for the clicks one report covers", () => {
  const url2 = "http://shop.test/help";
  const held = (input: InputId, count: number, page = page1): Happening => ({
    kind: "inputHeld",
    input,
    page,
    held: { kind: "click", count },
  });
  const takenOf = (id: SnapshotId, page = page1): Happening => ({
    kind: "snapshotTaken",
    snapshot: { ...snapshot(id), page },
  });
  const settledOn = (input: InputId, page = page1): Happening => ({
    kind: "pageSettled",
    page,
    input,
  });
  const clickOf = (count: number): InteractionReport => ({
    ...click,
    values: { button: "left", clickCount: count },
  });
  const reportedOn = (report: InteractionReport, page = page1): Happening => ({
    kind: "interactionReported",
    page,
    report,
  });
  const written = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId,
    at: number,
    page = page1
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: { page, report, before, after, at },
    },
  });
  /** Three clicks held one behind the other, the last one settled: each
   * one's "after" is the next one's "before". */
  const three = (counts: readonly [number, number, number]) => [
    held(input1, counts[0]),
    held(input2, counts[1]),
    held(input3, counts[2]),
    takenOf(snapshot1),
    passedOn(input1, 21),
    takenOf(snapshot2),
    passedOn(input2, 22),
    takenOf(snapshot3),
    passedOn(input3, 23),
    settledOn(input3),
    takenOf(snapshot4),
  ];

  it.each<{ name: string; happened: Happening[]; todo: ToDo[] }>([
    {
      name: "a report without a count covers its own click only",
      happened: [opened, ...started, ...three([1, 2, 3]), reportedOn(click)],
      todo: [written(click, snapshot1, snapshot2, 21)],
    },
    {
      name: "a report of count two covers no click that starts a count of its own",
      happened: [
        opened,
        ...started,
        ...three([1, 1, 2]),
        reportedOn(clickOf(2)),
      ],
      todo: [written(clickOf(2), snapshot1, snapshot2, 21)],
    },
    {
      name: "a report of count two covers the second click and not a third: it ends where the second does",
      happened: [
        opened,
        ...started,
        ...three([1, 2, 3]),
        reportedOn(clickOf(2)),
      ],
      todo: [written(clickOf(2), snapshot1, snapshot3, 21)],
    },
    {
      name: "three clicks reported one by one are each written: a report gives up on no click behind its own",
      happened: [
        opened,
        ...started,
        ...three([1, 1, 1]),
        reportedOn(clickOf(1)),
        reportedOn(clickOf(1)),
        reportedOn(clickOf(1)),
      ],
      todo: [written(clickOf(1), snapshot3, snapshot4, 23)],
    },
    {
      name: "a report of count three covers all three clicks",
      happened: [
        opened,
        ...started,
        ...three([1, 2, 3]),
        reportedOn(clickOf(3)),
      ],
      todo: [written(clickOf(3), snapshot1, snapshot4, 21)],
    },
    {
      name: "a report covers the clicks of its own page, whatever was held on another page between them",
      happened: [
        opened,
        { kind: "pageOpened", page: page2, url: url2 },
        ...started,
        held(input1, 1),
        held(input2, 1, page2),
        held(input3, 2),
        takenOf(snapshot1),
        takenOf(snapshot2, page2),
        passedOn(input1, 21),
        takenOf(snapshot3),
        passedOn(input3, 23),
        settledOn(input3),
        takenOf(snapshot4),
        reportedOn(clickOf(2)),
      ],
      todo: [written(clickOf(2), snapshot1, snapshot4, 21)],
    },
    {
      name: "a report covers the clicks behind its own, also when a click of another page was held before them",
      happened: [
        opened,
        { kind: "pageOpened", page: page2, url: url2 },
        ...started,
        held(input1, 1, page2),
        held(input2, 1),
        held(input3, 2),
        takenOf(snapshot1, page2),
        takenOf(snapshot2),
        passedOn(input2, 22),
        takenOf(snapshot3),
        passedOn(input3, 23),
        settledOn(input3),
        takenOf(snapshot4),
        reportedOn(clickOf(2)),
      ],
      todo: [written(clickOf(2), snapshot2, snapshot4, 22)],
    },
  ])("$name", ({ happened, todo }) => {
    expect(writes(run(happened)).at(-1)).toEqual(todo);
  });
});

// The change analysis of the branch, second batch: rules of the lifecycle
// that no row reached, each named by what it keeps.
describe("the lifecycle, for rules no row reached", () => {
  const url2 = "http://shop.test/help";
  const opened2: Happening = {
    kind: "pageOpened",
    page: page2,
    url: url2,
  };
  const closed2: Happening = {
    kind: "pageClosed",
    page: page2,
    pagesLeft: 1,
  };
  const held = (input: InputId, what: HeldInput, page = page1): Happening => ({
    kind: "inputHeld",
    input,
    page,
    held: what,
  });
  const clickOn = (page: PageId, input: InputId) =>
    held(input, { kind: "click", count: 1 }, page);
  const choice: InteractionReport = {
    type: "select",
    selector: "internal:role=combobox",
    target: null,
    values: { options: ["eggs"] },
  };
  const visible: InteractionReport = {
    type: "assertVisible",
    selector: "internal:role=heading",
    target: null,
    values: {},
  };
  const clickOf = (count: number): InteractionReport => ({
    ...click,
    values: { button: "left", clickCount: count },
  });
  const reportedOn = (report: InteractionReport, page = page1): Happening => ({
    kind: "interactionReported",
    page,
    report,
  });
  const written = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId | null,
    at = 20,
    more: { page?: PageId; beforeFromReport?: true } = {}
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: more.page ?? page1,
        report,
        before,
        after,
        at,
        ...(more.beforeFromReport ? { beforeFromReport: true } : {}),
      },
    },
  });
  const fromReport = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId
  ) => written(report, before, after, 10, { beforeFromReport: true });
  const assert: Happening = {
    kind: "command",
    command: { type: "assertVisibility" },
  };
  const picking = (on: boolean): Happening => ({ kind: "picking", on });
  const pick = (on: boolean): ToDo => ({
    kind: "browser",
    ask: { kind: "pick", on },
  });
  const timeLimit: Happening = { kind: "timeLimitPassed" };
  /** A click that reached its page and waits for its Settled Page. */
  const clickSettling = [clickHeld(input1), taken(snapshot1), passedOn(input1)];
  /** The first click of a double click reported with its count while the
   * second is on its way. */
  const doubleReportedEarly = [
    held(input1, { kind: "click", count: 1 }),
    held(input2, { kind: "click", count: 2 }),
    taken(snapshot1),
    passedOn(input1, 21),
    reportedOn(clickOf(2)),
    taken(snapshot2),
  ];

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: Partial<RecorderPhase>;
  }>([
    // Pages.
    {
      name: "a page that opened while recording is read at the end like the others",
      happened: [opened, ...started, opened2, finish, gateOff],
      todo: [[snap(snapshot1, page1), snap(snapshot2, page2)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a click held on a page that closes before it is passed on is waited for no more: the wrap-up ends",
      happened: [
        opened,
        opened2,
        ...started,
        clickOn(page2, input1),
        closed2,
        finish,
        gateOff,
        takenOf(snapshot2, page1),
      ],
      todo: [[kept(snapshot2, page1), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "a page that closes during a wrap-up before the last snapshots are asked for changes nothing else",
      happened: [opened, opened2, ...started, finish, closed2],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a snapshot nobody asked for is not kept while a wrap-up waits for its last snapshots",
      happened: [opened, ...started, finish, gateOff, taken(snapshot9)],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a click reported while wrapping up is recorded on whichever open page it was made",
      happened: [
        opened,
        opened2,
        ...started,
        stop,
        gateOff,
        takenOf(snapshot1, page1),
        takenOf(snapshot2, page2),
        reportedOn(click, page2),
      ],
      todo: [[waitOn(page2, reported1)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a click reported while wrapping up on a page that is not open is not recorded",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken(snapshot1),
        reportedOn(click, page9),
      ],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },

    // The trace.
    {
      name: "a trace told stopped a second time writes no second package",
      happened: [...stopped, finish, traceStopped, traceStopped],
      todo: [[save], []],
      state: { phase: "saving" },
    },
    {
      name: "a wrap-up that waits for its trace to start goes on without it when the trace cannot be started",
      happened: [opened, record, finish, gateOff, failed(startTrace)],
      todo: [[], [takeSnapshot(snapshot1)]],
      state: { phase: "wrappingUp" },
    },

    // Whose report it is.
    {
      name: "a report that comes while a click's 'before' is still being taken is not that click's: it has not reached the page",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        reported,
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
      ],
      todo: [[keep(snapshot2), letThrough(input1)]],
      state: { phase: "recording" },
    },
    {
      name: "a report that comes while a click still waits behind another is not that click's",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        clickHeld(input2),
        reported,
        reported,
        passedOn(input1),
        taken(snapshot2),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
      ],
      todo: [
        [keep(snapshot2), passOn(input2), interaction(snapshot1, snapshot2)],
        [waitForSettled(input2)],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), letThrough(input2)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a key pressed on a focused element keeps the target Playwright names",
      happened: [
        opened,
        ...started,
        held(input1, { kind: "press" }),
        taken(snapshot1),
        passedOn(input1),
        settled(input1),
        taken(snapshot2),
        reportedOn({
          type: "press",
          selector: "internal:role=textbox",
          target: { ref: pictureRef("e1"), tree: "- textbox [ref=e1]" },
          values: { key: "Enter" },
        }),
      ],
      todo: [
        [
          written(
            {
              type: "press",
              selector: "internal:role=textbox",
              target: { ref: pictureRef("e1"), tree: "- textbox [ref=e1]" },
              values: { key: "Enter" },
            },
            snapshot1,
            snapshot2
          ),
        ],
      ],
      state: { phase: "recording" },
    },

    // Where an input that is not held back starts and ends.
    {
      name: "a choice reported on one page starts at once, whatever still settles on another",
      happened: [
        opened,
        opened2,
        ...started,
        clickOn(page1, input1),
        takenOf(snapshot1, page1),
        passedOn(input1),
        reportedOn(choice, page2),
      ],
      todo: [[snap(snapshot2, page2)]],
      state: { phase: "recording" },
    },
    {
      name: "typing on one page is not ended by a click held on another",
      happened: [
        opened,
        opened2,
        ...started,
        reportedOn(typed("m"), page1),
        takenOf(snapshot1, page1),
        clickOn(page2, input1),
        takenOf(snapshot2, page2),
        settledOn(page1, reported1),
      ],
      todo: [
        [snap(snapshot2, page2)],
        [kept(snapshot2, page2), passOn(input1)],
        [snap(snapshot3, page1)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "typing that has its 'after' is not written for a click held on another page: nothing newer happened on its own",
      happened: [
        opened,
        opened2,
        ...started,
        reportedOn(typed("m"), page1),
        takenOf(snapshot1, page1),
        settledOn(page1, reported1),
        takenOf(snapshot2, page1),
        clickOn(page2, input1),
      ],
      todo: [[snap(snapshot3, page2)]],
      state: { phase: "recording" },
    },
    {
      name: "typing that has its 'after' is not written for a key typed after it: that key may be its own next",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedOn(typed("m")),
        settled(reported1),
        taken(snapshot3),
        held(input2, { kind: "typing" }),
      ],
      todo: [[passOn(input2)]],
      state: { phase: "recording" },
    },
    {
      name: "a key that reached its page and is never reported does not keep the wrap-up waiting",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        held(input2, { kind: "typing" }),
        passedOn(input2),
        finish,
        gateOff,
        taken(snapshot3),
      ],
      todo: [[keep(snapshot3), stopTrace]],
      state: { phase: "saving" },
    },

    {
      name: "a choice reported while one snapshot is taken for two clicks starts at that snapshot and ends there: the second click starts where it does",
      happened: [
        opened,
        ...started,
        ...clickSettling,
        clickHeld(input2),
        reportedOn(choice),
        taken(snapshot2),
      ],
      todo: [
        [],
        [
          keep(snapshot2),
          passOn(input2),
          fromReport(choice, snapshot2, snapshot2),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a choice reported while the second click of a double click is on its way gives up on neither click: the double click ends where its second click does",
      happened: [
        opened,
        ...started,
        ...doubleReportedEarly,
        reportedOn(choice),
        passedOn(input2, 22),
        taken(snapshot3),
      ],
      todo: [
        [
          keep(snapshot3),
          waitForSettled(reported1),
          written(clickOf(2), snapshot1, snapshot3, 21),
          letThrough(input2),
        ],
      ],
      state: { phase: "recording" },
    },

    {
      name: "a choice reported while a click is on its way and another waits behind it goes between the two: it starts where the first ends, and ends where the second starts",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        clickHeld(input2),
        reportedOn(choice),
        passedOn(input1),
        taken(snapshot2),
      ],
      todo: [
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), waitForSettled(reported1), takeSnapshot(snapshot3)],
      ],
      state: { phase: "recording" },
    },
    // Inputs are written in the order the person gave them (rule 11), and
    // each "after" is no later than the next "before" (rule 12), also for
    // two inputs that are not held back and are reported one after the
    // other.
    {
      name: "a choice and then typing, both reported while a click is on its way and another waits behind it, are written in that order between the two clicks (rules 11 and 12)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        clickHeld(input2),
        reportedOn(choice),
        reportedOn(typed("m")),
        passedOn(input1),
        taken(snapshot2),
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), waitForSettled(reported1), takeSnapshot(snapshot3)],
        [
          keep(snapshot3),
          passOn(input2),
          fromReport(choice, snapshot2, snapshot3),
          fromReport(typed("m"), snapshot3, snapshot3),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a choice and then typing, both reported before their page has a snapshot, are written in that order: one snapshot is the choice's 'after' and the typing's 'before' (rules 11 and 12)",
      happened: [
        opened,
        ...started,
        reportedOn(choice),
        reportedOn(typed("m")),
        taken(snapshot1),
        taken(snapshot2),
        settled(reported2),
        taken(snapshot3),
        finish,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [],
        [
          keep(snapshot1),
          waitForSettled(reported1),
          takeSnapshot(snapshot2),
          letThrough(null),
        ],
        [
          keep(snapshot2),
          waitForSettled(reported2),
          fromReport(choice, snapshot1, snapshot2),
        ],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot4)],
        [
          keep(snapshot4),
          fromReport(typed("m"), snapshot2, snapshot3),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "typing whose wait for a Settled Page ends while a click's 'before' is being taken still ends at that snapshot, and takes none of its own",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedOn(typed("m")),
        clickHeld(input2),
        settled(reported1),
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [],
        [
          keep(snapshot3),
          passOn(input2),
          fromReport(typed("m"), snapshot2, snapshot3),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click whose report comes after the report of a later choice on its page is given up, whatever is held on another page",
      happened: [
        opened,
        opened2,
        ...started,
        clickOn(page1, input1),
        clickOn(page2, input2),
        takenOf(snapshot2, page2),
        passedOn(input2),
        settledOn(page2, input2),
        takenOf(snapshot3, page2),
        reportedOn(choice, page2),
        reportedOn(click, page2),
      ],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a click that another one's report covers takes no report of its own: a second report of the double click is written nowhere",
      happened: [
        opened,
        ...started,
        ...doubleReportedEarly,
        reportedOn(clickOf(1)),
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
      ],
      todo: [
        [
          keep(snapshot3),
          written(clickOf(2), snapshot1, snapshot3, 21),
          letThrough(input2),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a request to start that fails when no recording is starting changes nothing",
      happened: [...stopped, failed(reportInteractions), failed(holdInputs)],
      todo: [[], []],
      state: { phase: "paused" },
    },

    // Each page has a gate of its own.
    {
      name: "a page is let through after its own click, whatever is still held on another page",
      happened: [
        opened,
        opened2,
        ...started,
        clickOn(page1, input1),
        clickOn(page2, input2),
        takenOf(snapshot2, page2),
        passedOn(input2),
        settledOn(page2, input2),
        takenOf(snapshot3, page2),
      ],
      todo: [[kept(snapshot3, page2), through(page2, input2)]],
      state: { phase: "recording" },
    },

    // The clicks one report covers.
    {
      name: "a double click reported before its second click has settled is written once that has, ending where it does",
      happened: [
        opened,
        ...started,
        ...doubleReportedEarly,
        passedOn(input2, 22),
        settled(input2),
        taken(snapshot3),
      ],
      todo: [
        [keep(snapshot2), passOn(input2)],
        [waitForSettled(input2)],
        [takeSnapshot(snapshot3)],
        [
          keep(snapshot3),
          written(clickOf(2), snapshot1, snapshot3, 21),
          letThrough(input2),
        ],
      ],
      state: { phase: "recording" },
    },

    // The time limit of a wrap-up.
    {
      name: "when the time limit passes, a double click whose second click never settled is written with what its first click changed",
      happened: [opened, ...started, ...doubleReportedEarly, stop, timeLimit],
      todo: [
        [
          written(clickOf(2), snapshot1, snapshot2, 21),
          holdNoMore,
          stopReporting,
        ],
      ],
      state: { phase: "paused" },
    },
    {
      name: "when the time limit passes, an assertion behind a click whose report never came is written all the same",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reportedOn(visible),
        taken(snapshot3),
        stop,
        timeLimit,
      ],
      todo: [[written(visible, snapshot3, snapshot3, 10), stopReporting]],
      state: { phase: "paused" },
    },

    // A request the browser could not carry out.
    {
      name: "a page that cannot be let through goes on holding: nothing else is asked",
      happened: [opened, ...started, failed(letThrough(null))],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "picking that cannot start is off again, and nothing is taken back: Assert visibility applies anew",
      happened: [opened, ...started, assert, failed(pick(true)), assert],
      todo: [[], [pick(true), reply("applied")]],
      state: { phase: "recording" },
    },
    {
      name: "picking that cannot be left counts as left",
      happened: [opened, ...started, failed(pick(false))],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a click that cannot be passed on is dropped by itself: one on its way on another page goes on",
      happened: [
        opened,
        opened2,
        ...started,
        clickOn(page1, input1),
        clickOn(page2, input2),
        takenOf(snapshot1, page1),
        takenOf(snapshot2, page2),
        failed(passOn(input1)),
        passedOn(input2),
      ],
      // Its page has nothing under way any more, and is let through.
      todo: [[through(page1, input1)], [waitOn(page2, input2)]],
      state: { phase: "recording" },
    },
    {
      name: "a click told not passed on after it was told passed on is recorded all the same",
      happened: [
        opened,
        ...started,
        ...clickSettling,
        failed(passOn(input1)),
        settled(input1),
        taken(snapshot2),
        reported,
      ],
      todo: [[interaction(snapshot1, snapshot2)]],
      state: { phase: "recording" },
    },
    {
      name: "a 'before' that cannot be taken passes on its own click only",
      happened: [
        opened,
        opened2,
        ...started,
        clickOn(page1, input1),
        clickOn(page2, input2),
        failed(snap(snapshot1, page1)),
      ],
      todo: [[passOn(input1)]],
      state: { phase: "recording" },
    },
    {
      name: "a 'before' that cannot be taken during a wrap-up, before its last snapshots are asked for, passes the click on",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        finish,
        failed(takeSnapshot(snapshot1)),
      ],
      todo: [[passOn(input1)]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a last snapshot that cannot be taken leaves the other pages' to be waited for",
      happened: [
        opened,
        opened2,
        ...started,
        finish,
        gateOff,
        failed(snap(snapshot1, page1)),
      ],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },

    // Assert visibility.
    {
      name: "Assert visibility waits while a key press is held back",
      happened: [opened, ...started, held(input1, { kind: "press" }), assert],
      todo: [[reply("applied")]],
      state: { phase: "recording" },
    },
    {
      name: "Assert visibility waits while a typed key is held back",
      happened: [opened, ...started, held(input1, { kind: "typing" }), assert],
      todo: [[reply("applied")]],
      state: { phase: "recording" },
    },
    {
      name: "Assert visibility does not wait for an input the pages never held",
      happened: [opened, ...started, reportedOn(choice), assert],
      todo: [[pick(true), reply("applied")]],
      state: { phase: "recording" },
    },
    {
      name: "Assert visibility that waited and was then asked of Playwright is taken back by a wrap-up",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        assert,
        taken(snapshot1),
        passedOn(input1),
        stop,
      ],
      todo: [
        [waitForSettled(input1), pick(true)],
        [pick(false), startTimeLimit, reply("applied")],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Playwright told out of picking while paused is asked nothing",
      happened: [...stopped, picking(false)],
      todo: [[]],
      state: { phase: "paused" },
    },
    {
      name: "Playwright told out of picking while Assert visibility is off is asked nothing",
      happened: [opened, ...started, picking(false)],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "once Playwright has left picking, the pages hold inputs again and Assert visibility applies anew",
      happened: [
        opened,
        ...started,
        assert,
        picking(true),
        picking(false),
        assert,
      ],
      todo: [[pick(false)], [pick(true), reply("applied")]],
      state: { phase: "recording" },
    },

    // Highlight.
    {
      name: "an element found for a highlight once the recorder has ended is answered 'ignored'",
      happened: [
        opened,
        ...started,
        {
          kind: "command",
          command: { type: "highlight", entry: entryId("one") },
        },
        { kind: "brokeDown", reason: "It broke." },
        { kind: "located", highlight: 1, target: null },
      ],
      todo: [[{ kind: "replyKept", key: "highlight_1", result: "ignored" }]],
      state: { phase: "ended" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    expect(result.state).toMatchObject(state);
  });
});

// A snapshot that cannot be taken, as while a page goes elsewhere, for an
// input no page held: an assertion, or an input known from its report.
// Nothing is asked to be passed on that no page held, nothing behind it is
// kept waiting, and what cannot be written is told as a warning.
describe("the lifecycle, for a snapshot that cannot be taken for an input no page held", () => {
  const reportedAs = (report: InteractionReport): Happening => ({
    kind: "interactionReported",
    page: page1,
    report,
  });
  const visible: InteractionReport = {
    type: "assertVisible",
    selector: 'internal:role=heading[name="Cart"i]',
    target: null,
    values: {},
  };
  const choice: InteractionReport = {
    type: "select",
    selector: "internal:role=combobox",
    target: null,
    values: { options: ["eggs"] },
  };
  const written = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId | null,
    at: number,
    beforeFromReport = false
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: page1,
        report,
        before,
        after,
        at,
        ...(beforeFromReport ? { beforeFromReport: true } : {}),
      },
    },
  });
  const afterOnly: ToDo = {
    kind: "warn",
    warning: {
      kind: "reportShape",
      message:
        "A page could not be read when typing, a choice or an upload was reported on it: it is recorded with its 'after' only.",
    },
  };
  const notRecorded = (what: string): ToDo => ({
    kind: "warn",
    warning: { kind: "notRecorded", message: what },
  });
  const timeLimit: Happening = { kind: "timeLimitPassed" };
  /** The first snapshot of a second page. */
  const snapshotOf2: ToDo = {
    kind: "browser",
    ask: {
      kind: "takeSnapshot",
      snapshot: snapshot1,
      page: page2,
    },
  };

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: Partial<RecorderPhase>;
  }>([
    // An assertion.
    {
      name: "an assertion whose snapshot cannot be taken is written at its page's latest snapshot: nothing is passed on, and two clicks held afterwards are passed on and recorded as usual (rules 1 and 2)",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(visible),
        failed(takeSnapshot(snapshot3)),
        clickHeld(input2),
        clickHeld(input3),
        taken(snapshot4),
        passedOn(input2, 22),
        taken(snapshot5),
        passedOn(input3, 23),
        settled(input3),
        taken(snapshot6),
        reported,
        reported,
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [written(visible, snapshot2, snapshot2, 10)],
        [takeSnapshot(snapshot4)],
        [],
        [keep(snapshot4), passOn(input2)],
        [takeSnapshot(snapshot5)],
        [keep(snapshot5), passOn(input3)],
        [waitForSettled(input3)],
        [takeSnapshot(snapshot6)],
        [keep(snapshot6), letThrough(input3)],
        [interaction(snapshot4, snapshot5, 22)],
        [interaction(snapshot5, snapshot6, 23)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "an assertion whose snapshot cannot be taken on a page that has none yet cannot be placed: it is left out, a person is told, and a click held afterwards goes on",
      happened: [
        opened,
        ...started,
        reportedAs(visible),
        failed(takeSnapshot(snapshot1)),
        clickHeld(input1),
        taken(snapshot2),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [
          notRecorded(
            `An assertion of internal:role=heading[name="Cart"i] is not recorded: its page could not be read.`
          ),
        ],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), passOn(input1)],
      ],
      state: { phase: "recording" },
    },

    // An input known from its report.
    {
      name: "a choice whose first snapshot cannot be taken is recorded with its 'after' only, with a warning; typing reported after it is still written, starting where the choice ends",
      happened: [
        opened,
        ...started,
        reportedAs(choice),
        failed(takeSnapshot(snapshot1)),
        reportedAs(typed("m")),
        taken(snapshot2),
        settled(reported2),
        taken(snapshot3),
        finish,
        gateOff,
        taken(snapshot4),
      ],
      todo: [
        [takeSnapshot(snapshot1)],
        [waitForSettled(reported1), afterOnly],
        [takeSnapshot(snapshot2)],
        [
          keep(snapshot2),
          waitForSettled(reported2),
          written(choice, snapshot2, snapshot2, 10),
          letThrough(null),
        ],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot4)],
        [
          keep(snapshot4),
          written(typed("m"), snapshot2, snapshot3, 10, true),
          stopTrace,
        ],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a choice whose first snapshot cannot be taken gets its one snapshot once the page is settled: it is its 'before' and its 'after'",
      happened: [
        opened,
        ...started,
        reportedAs(choice),
        failed(takeSnapshot(snapshot1)),
        settled(reported1),
        taken(snapshot2),
        finish,
        gateOff,
        taken(snapshot3),
      ],
      todo: [
        [waitForSettled(reported1), afterOnly],
        [takeSnapshot(snapshot2)],
        [keep(snapshot2), letThrough(null)],
        [...wrapUp, reply("applied")],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), written(choice, snapshot2, snapshot2, 10), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a choice whose 'after' cannot be taken either is left out, and a person is told: nothing behind it waits for it",
      happened: [
        opened,
        ...started,
        reportedAs(choice),
        failed(takeSnapshot(snapshot1)),
        settled(reported1),
        failed(takeSnapshot(snapshot2)),
        reportedAs(typed("m")),
      ],
      todo: [
        [takeSnapshot(snapshot2)],
        [
          notRecorded(
            "Typing, a choice or an upload is not recorded: its page could not be read."
          ),
        ],
        [takeSnapshot(snapshot3)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "typing that was to start at a snapshot shared with the choice before it starts at the page's latest snapshot when that one cannot be taken: nothing is passed on",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(choice),
        reportedAs(typed("m")),
        failed(takeSnapshot(snapshot3)),
      ],
      todo: [
        [waitForSettled(reported1)],
        [takeSnapshot(snapshot3)],
        [waitForSettled(reported2), written(choice, snapshot2, null, 10, true)],
      ],
      state: { phase: "recording" },
    },

    {
      name: "a choice that is left out takes nothing else with it: typing that was to start where it ends is recorded with its 'after' only",
      happened: [
        opened,
        ...started,
        reportedAs(choice),
        failed(takeSnapshot(snapshot1)),
        reportedAs(typed("m")),
        failed(takeSnapshot(snapshot2)),
        settled(reported2),
        taken(snapshot3),
      ],
      todo: [
        [takeSnapshot(snapshot2)],
        [
          notRecorded(
            "Typing, a choice or an upload is not recorded: its page could not be read."
          ),
          waitForSettled(reported2),
          afterOnly,
        ],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), letThrough(null)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a choice whose first snapshot cannot be taken on a page that opened while recording, and held nothing, is recorded with its 'after' only",
      happened: [
        opened,
        ...started,
        {
          kind: "pageOpened",
          page: page2,
          url: "http://shop.test/help",
        },
        { kind: "interactionReported", page: page2, report: choice },
        failed(snapshotOf2),
      ],
      todo: [
        [snapshotOf2],
        [
          {
            kind: "browser",
            ask: {
              kind: "waitForSettled",
              page: page2,
              input: reported1,
            },
          },
          afterOnly,
        ],
      ],
      state: { phase: "recording" },
    },

    // The time limit of a wrap-up.
    {
      name: "when the time limit passes while a choice waits for its first snapshot, nothing is asked to be passed on: no page held it",
      happened: [opened, ...started, reportedAs(choice), stop, timeLimit],
      todo: [[holdNoMore, stopReporting]],
      state: { phase: "paused" },
    },
    {
      name: "when the time limit passes while an assertion waits for its snapshot, nothing is asked to be passed on",
      happened: [opened, ...started, reportedAs(visible), stop, timeLimit],
      todo: [[holdNoMore, stopReporting]],
      state: { phase: "paused" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(writes(result).slice(-todo.length)).toEqual(todo);
    expect(result.state).toMatchObject(state);
  });
});

// The address of the page that is open, which the window's title names.
describe("the lifecycle, for the address of the page that is open", () => {
  const after = (happened: readonly Happening[]) =>
    openAddress(
      happened.reduce(
        (state, happening) => step(state, happening).state,
        initialState
      )
    );

  it("is none before a page opens, and the page's from when it opens, before anything is recorded", () => {
    expect(after([])).toBeNull();
    expect(after([opened])).toBe(url);
  });

  it("follows the page wherever it goes, a new hash too, recording or not", () => {
    expect(after([opened, navigated(`${url}#more`)])).toBe(`${url}#more`);
    expect(
      after([opened, ...started, navigated("http://shop.test/cart")])
    ).toBe("http://shop.test/cart");
    expect(
      after([opened, ...started, stop, gateOff, navigated(`${url}#paused`)])
    ).toBe(`${url}#paused`);
  });

  it("is the page that opened last of those still open", () => {
    const second: Happening = {
      kind: "pageOpened",
      page: page2,
      url: "http://shop.test/help",
    };
    expect(after([opened, second])).toBe("http://shop.test/help");
    expect(
      after([opened, second, { kind: "pageClosed", page: page2, pagesLeft: 1 }])
    ).toBe(url);
    expect(
      after([opened, { kind: "pageClosed", page: page1, pagesLeft: 0 }])
    ).toBeNull();
  });
});

// Typing shows while it is typed: a fill is in the window from its first
// report, its text follows every key, and the rows under it follow each
// read of its page, until the next action makes it final.
describe("the lifecycle, for a fill while it is typed", () => {
  const reportedAs = (report: InteractionReport): Happening => ({
    kind: "interactionReported",
    page: page1,
    report,
  });
  const revised = (report: InteractionReport): Happening => ({
    kind: "interactionRevised",
    page: page1,
    report,
  });
  const fill = (text: string): InteractionReport => ({
    type: "fill",
    selector: "internal:role=textbox",
    target: null,
    values: { text },
  });
  const choice: InteractionReport = {
    type: "select",
    selector: "internal:role=combobox",
    target: null,
    values: { options: ["Large"] },
  };
  /** A fill as the timeline is told it, under its key: the same while it
   * shows and when it is final. Which it is, the lifecycle's inputs say
   * (`showing`). */
  const shown = (
    report: InteractionReport,
    before: SnapshotId,
    after: SnapshotId | null,
    input = reported1
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      key: `${before}:${input}`,
      interaction: {
        page: page1,
        report,
        before,
        after,
        at: 10,
        beforeFromReport: true,
      },
    },
  });
  /** A fill as the timeline is told it when it is final. */
  const final = shown;
  /** Only the text of a fill that is final. */
  const retext = (
    report: InteractionReport,
    before: SnapshotId,
    input = reported1
  ): ToDo => ({
    kind: "timeline",
    add: { kind: "text", key: `${before}:${input}`, report },
  });
  /** A click recorded: the page's latest snapshot is snapshot 2. */
  const clicked = [opened, ...started, ...oneClick, reported];
  const timeLimit: Happening = { kind: "timeLimitPassed" };

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: Partial<RecorderPhase>;
    /** The fills that show and can still change at the end, by key. */
    showing?: string[];
  }>([
    {
      name: "a fill shows as soon as Playwright reports it, before the page is read: its text, and no changes yet (rules 1 and 3)",
      happened: [...clicked, reportedAs(fill("m"))],
      todo: [[waitForSettled(reported1), shown(fill("m"), snapshot2, null)]],
      state: { phase: "recording" },
      showing: ["snapshot_2:reported_1"],
    },
    {
      name: "a fill waits to show for one read when the page was not read since Record (rule 3)",
      happened: [opened, ...started, reportedAs(fill("m")), taken(snapshot1)],
      todo: [
        [takeSnapshot(snapshot1)],
        [
          keep(snapshot1),
          waitForSettled(reported1),
          shown(fill("m"), snapshot1, null),
          letThrough(null),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a fill never shows before the entry above it: one typed while the click before it still settles shows with that click's 'after' (rule 3)",
      happened: [
        opened,
        ...started,
        clickHeld(input1),
        taken(snapshot1),
        passedOn(input1),
        reported,
        reportedAs(fill("m")),
        settled(input1),
        taken(snapshot2),
      ],
      todo: [
        [],
        [],
        [takeSnapshot(snapshot2)],
        [
          keep(snapshot2),
          waitForSettled(reported1),
          interaction(snapshot1, snapshot2),
          shown(fill("m"), snapshot2, null),
          letThrough(input1),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a fill's text follows every key at once (rule 1)",
      happened: [...clicked, reportedAs(fill("m")), revised(fill("mi"))],
      todo: [[shown(fill("mi"), snapshot2, null)]],
      state: { phase: "recording" },
    },
    {
      name: "the rows under a fill follow each read of its page, and its text can be ahead of them (rule 2)",
      happened: [
        ...clicked,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        revised(fill("mi")),
        settled(reported1),
        taken(snapshot4),
      ],
      todo: [
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), shown(fill("m"), snapshot2, snapshot3)],
        [waitForSettled(reported1), shown(fill("mi"), snapshot2, snapshot3)],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4), shown(fill("mi"), snapshot2, snapshot4)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the next action makes a fill final: its place and rows stay, and a revision after it sets only its text (rule 5)",
      happened: [
        ...clicked,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        clickHeld(input2),
        revised(fill("mi")),
        taken(snapshot4),
      ],
      todo: [
        [takeSnapshot(snapshot4), final(fill("m"), snapshot2, snapshot3)],
        [retext(fill("mi"), snapshot2)],
        [keep(snapshot4), passOn(input2)],
      ],
      state: { phase: "recording" },
      showing: [],
    },
    {
      name: "a revision of another kind after a fill is final sets no text of the fill's (rule 5)",
      happened: [
        ...clicked,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        clickHeld(input2),
        revised(choice),
      ],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a revision after a newer report is dropped: it is not the fill's (rule 5)",
      happened: [
        ...clicked,
        reportedAs(fill("m")),
        settled(reported1),
        taken(snapshot3),
        clickHeld(input2),
        taken(snapshot4),
        passedOn(input2),
        reported,
        revised(fill("mi")),
      ],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "Stop keeps a fill's last text: its rows catch up with it before Paused shows (rule 6)",
      happened: [
        ...clicked,
        reportedAs(fill("m")),
        revised(fill("mi")),
        stop,
        settled(reported1),
        taken(snapshot3),
        gateOff,
        taken(snapshot4),
        reportingOff,
      ],
      todo: [
        [startTimeLimit, reply("applied")],
        [takeSnapshot(snapshot3)],
        [keep(snapshot3), holdNoMore, shown(fill("mi"), snapshot2, snapshot3)],
        [takeSnapshot(snapshot4)],
        [keep(snapshot4), stopReporting],
        [final(fill("mi"), snapshot2, snapshot3)],
      ],
      state: { phase: "paused" },
    },
    {
      name: "a fill that showed is kept when the wrap-up's time limit passes before its read (rule 7)",
      happened: [...clicked, reportedAs(fill("m")), stop, timeLimit],
      todo: [[holdNoMore, stopReporting]],
      state: { phase: "paused" },
    },
    {
      name: "a choice shows once, when it is reported (rule 9)",
      happened: [...clicked, reportedAs(choice), settled(reported1)],
      todo: [
        [waitForSettled(reported1), shown(choice, snapshot2, null)],
        [takeSnapshot(snapshot3)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "bug 7: after Stop, a key the page held that reached it keeps the pages holding until its page settles, so its typing's report comes first and a click right after it is held with a 'before' of its own",
      happened: [
        opened,
        ...started,
        {
          kind: "inputHeld",
          input: input1,
          page: page1,
          held: { kind: "typing" },
        },
        stop,
        taken(snapshot1),
        passedOn(input1),
        reportedAs(fill("a")),
        clickHeld(input2),
        taken(snapshot2),
      ],
      todo: [
        [startTimeLimit, reply("applied")],
        [keep(snapshot1), passOn(input1)],
        // Not yet "hold no more": its typing is not reported yet.
        [waitForSettled(input1)],
        [waitForSettled(reported1), shown(fill("a"), snapshot1, null)],
        [takeSnapshot(snapshot2)],
        [
          keep(snapshot2),
          passOn(input2),
          final(fill("a"), snapshot1, snapshot2),
        ],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "bug 6: typing more into a field after Continue, which Playwright revises into the fill before the pause, is a fill of its own",
      happened: [
        ...clicked,
        reportedAs(fill("ab")),
        settled(reported1),
        taken(snapshot3),
        stop,
        gateOff,
        taken(snapshot4),
        reportingOff,
        resume,
        reporting,
        holding,
        taken(snapshot5),
        revised(fill("abcd")),
      ],
      todo: [[waitForSettled(reported1), shown(fill("abcd"), snapshot5, null)]],
      state: { phase: "recording" },
    },
  ])("$name", ({ happened, todo, state, showing }) => {
    const result = run(happened);
    expect(result.todo.slice(-todo.length)).toEqual(todo);
    expect(result.state).toMatchObject(state);
    if (showing) expect([...result.showing.at(-1)!]).toEqual(showing);
  });
});

// Middle clicks are held and recorded as clicks are; a report is the held
// click's only when it is of the same button.
describe("the lifecycle, for a middle click", () => {
  const middleHeld = (input: InputId): Happening => ({
    kind: "inputHeld",
    input,
    page: page1,
    held: { kind: "click", count: 1, button: "middle" },
  });
  const report = (button: string): Happening => ({
    kind: "interactionReported",
    page: page1,
    report: { ...click, values: { button, clickCount: 1 } },
  });
  /** The Interactions written, each with the button of its report. */
  const writtenButtons = (todo: readonly (readonly ToDo[])[]) =>
    todo.flat().flatMap((item) =>
      item.kind === "timeline" && item.add.kind === "interaction"
        ? [
            {
              button: item.add.interaction.report.values["button"],
              before: item.add.interaction.before,
              after: item.add.interaction.after,
            },
          ]
        : []
    );

  it("records a middle click held behind a click, in order, each with its own report (M2)", () => {
    const { todo } = run([
      opened,
      ...started,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      middleHeld(input2),
      taken(snapshot2),
      passedOn(input2),
      report("left"),
      report("middle"),
      settled(input2),
      taken(snapshot3),
    ]);

    expect(writtenButtons(todo)).toEqual([
      { button: "left", before: snapshot1, after: snapshot2 },
      { button: "middle", before: snapshot2, after: snapshot3 },
    ]);
  });

  it("never gives a middle click's report to a held click of another button that still waits for its own (M1)", () => {
    const { todo } = run([
      opened,
      ...started,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      // A middle click no page held, as on an element the gate leaves alone.
      report("middle"),
      report("left"),
      settled(input1),
      taken(snapshot2),
    ]);

    expect(writtenButtons(todo)).toEqual([
      { button: "left", before: snapshot1, after: snapshot2 },
    ]);
  });

  // Playwright reports a middle click on a checkbox or a radio as the
  // check or uncheck it did not make, with no button.
  const toggled = (type: "check" | "uncheck"): Happening => ({
    kind: "interactionReported",
    page: page1,
    report: {
      type,
      selector: "internal:role=checkbox",
      target: null,
      values: {},
    },
  });
  const steps = (todo: readonly (readonly ToDo[])[]) =>
    todo.flat().flatMap((item) =>
      item.kind === "timeline" && item.add.kind === "interaction"
        ? [
            {
              type: item.add.interaction.report.type,
              button: item.add.interaction.report.values["button"],
            },
          ]
        : []
    );

  it("records a middle click on a checkbox as a middle click, from the uncheck Playwright reports for it, and Stop waits for nothing more", () => {
    const { todo, state } = run([
      opened,
      ...started,
      middleHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      toggled("uncheck"),
      settled(input1),
      taken(snapshot2),
      stop,
      gateOff,
      taken(snapshot3),
      reportingOff,
    ]);

    expect(steps(todo)).toEqual([{ type: "click", button: "middle" }]);
    expect(state).toEqual({ phase: "paused" });
  });

  it("holds up no later click behind a middle click on a checkbox", () => {
    const { todo } = run([
      opened,
      ...started,
      middleHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      toggled("check"),
      clickHeld(input2),
      taken(snapshot2),
      passedOn(input2),
      report("left"),
      settled(input2),
      taken(snapshot3),
    ]);

    expect(steps(todo)).toEqual([
      { type: "click", button: "middle" },
      { type: "click", button: "left" },
    ]);
  });

  it("never gives the check a middle click on a checkbox is reported by to a later click", () => {
    // The page is read quickly after the middle click; Playwright's report
    // of it comes once the next click is on its way.
    const { todo } = run([
      opened,
      ...started,
      middleHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      clickHeld(input2),
      taken(snapshot2),
      passedOn(input2),
      toggled("check"),
      report("left"),
      settled(input2),
      taken(snapshot3),
    ]);

    expect(steps(todo)).toEqual([
      { type: "click", button: "middle" },
      { type: "click", button: "left" },
    ]);
  });

  it("never gives a check to a right click", () => {
    const { todo } = run([
      opened,
      ...started,
      {
        kind: "inputHeld",
        input: input1,
        page: page1,
        held: { kind: "click", count: 1, button: "right" },
      },
      taken(snapshot1),
      passedOn(input1),
      toggled("check"),
      report("right"),
      settled(input1),
      taken(snapshot2),
      middleHeld(input2),
    ]);

    expect(steps(todo)).toEqual([{ type: "click", button: "right" }]);
  });

  it("still records a left click on a checkbox as the check Playwright reports", () => {
    const { todo } = run([
      opened,
      ...started,
      clickHeld(input1),
      taken(snapshot1),
      passedOn(input1),
      toggled("check"),
      settled(input1),
      taken(snapshot2),
      middleHeld(input2),
    ]);

    expect(steps(todo)).toEqual([{ type: "check", button: undefined }]);
  });
});
