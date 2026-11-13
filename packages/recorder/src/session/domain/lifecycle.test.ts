import { describe, expect, it } from "vitest";

import type { RecorderPhase } from "../../contract";
import type { InteractionReport, PageSnapshot } from "../../timeline/domain";
import {
  initialState,
  shown,
  step,
  WRAP_UP_LIMIT_MS,
  type Happening,
  type HeldInput,
  type ToDo,
} from "./lifecycle";

// The lifecycle as a table: things that happened, in order, must give this
// state and these lists of things to do. No browser, no clock.

const url = "http://shop.test/";
const opened: Happening = { kind: "pageOpened", page: "page_1", url };
const record: Happening = { kind: "command", command: { type: "record" } };
const finish: Happening = { kind: "command", command: { type: "finish" } };
const reporting: Happening = { kind: "reportingInteractions", on: true };
const holding: Happening = { kind: "inputsHeld", on: true };
/** Record, up to the pages holding inputs back. */
const started = [record, reporting, holding];
const outsideEnd: Happening = { kind: "outsideEnd" };
const clickHeld = (input: string): Happening => ({
  kind: "inputHeld",
  input,
  page: "page_1",
});
const snapshot = (id: string): PageSnapshot => ({
  id,
  page: "page_1",
  url,
  at: 10,
  tree: `- button "Add" [ref=e2]`,
});
const taken = (id: string): Happening => ({
  kind: "snapshotTaken",
  snapshot: snapshot(id),
});
const passedOn = (input: string, at = 20): Happening => ({
  kind: "inputPassedOn",
  input,
  at,
});
const settled = (input: string): Happening => ({
  kind: "pageSettled",
  page: "page_1",
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
  page: "page_1",
  report: click,
};
const gateOff: Happening = { kind: "inputsHeld", on: false };
const saved: Happening = { kind: "saved", folder: "/project/rec_1" };

// What the lifecycle asks for, in short.
const reply = (result: "applied" | "ignored"): ToDo => ({
  kind: "reply",
  result,
});
const takeSnapshot = (id: string): ToDo => ({
  kind: "browser",
  ask: { kind: "takeSnapshot", snapshot: id, page: "page_1" },
});
const keep = (id: string): ToDo => ({
  kind: "timeline",
  add: { kind: "snapshot", snapshot: snapshot(id) },
});
const passOn = (input: string): ToDo => ({
  kind: "browser",
  ask: { kind: "passOn", input },
});
const waitForSettled = (input: string): ToDo => ({
  kind: "browser",
  ask: { kind: "waitForSettled", page: "page_1", input },
});
const interaction = (before: string, after: string | null, at = 20): ToDo => ({
  kind: "timeline",
  add: {
    kind: "interaction",
    interaction: { page: "page_1", report: click, before, after, at },
  },
});
const startVisit: ToDo = {
  kind: "timeline",
  add: { kind: "visit", page: "page_1", url, cause: "initial" },
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
const wrapUp: ToDo[] = [
  { kind: "browser", ask: { kind: "holdInputs", on: false } },
  { kind: "startTimeLimit", ms: WRAP_UP_LIMIT_MS },
];
const trace = { file: "/tmp/trace.zip", positions: { snapshot_1: "11" } };
const stopTrace: ToDo = {
  kind: "browser",
  ask: { kind: "stopTrace", keep: true },
};
const discardTrace: ToDo = {
  kind: "browser",
  ask: { kind: "stopTrace", keep: false },
};
const traceStopped: Happening = { kind: "traceStopped", trace };
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
  taken("snapshot_1"),
  reportingOff,
];
// Visits.
const navigated = (to: string, page = "page_1"): Happening => ({
  kind: "pageNavigated",
  page,
  url: to,
});
const visitAt = (
  at: string,
  cause: "initial" | "navigate" | "openPage",
  page = "page_1"
): ToDo => ({
  kind: "timeline",
  add: { kind: "visit", page, url: at, cause },
});
// Every kind of input.
const letThrough = (upTo: string | null): ToDo => ({
  kind: "browser",
  ask: { kind: "letInputsThrough", page: "page_1", upTo },
});

/** One click from held to settled, with nothing else going on. */
const oneClick = [
  clickHeld("input_1"),
  taken("snapshot_1"),
  passedOn("input_1"),
  settled("input_1"),
  taken("snapshot_2"),
];

/** Everything the lifecycle asked for along the way, and where it stands. */
function run(happened: readonly Happening[]) {
  let state = initialState;
  const todo: ToDo[][] = [];
  for (const happening of happened) {
    const next = step(state, happening);
    state = next.state;
    todo.push([...next.todo]);
  }
  return { state: shown(state), todo };
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
    state: RecorderPhase;
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
      happened: [opened, { kind: "pageClosed", page: "page_1", pagesLeft: 0 }],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "closing a page while another is open changes nothing",
      happened: [
        opened,
        { kind: "pageOpened", page: "page_2", url },
        { kind: "pageClosed", page: "page_2", pagesLeft: 1 },
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
      todo: [
        [startVisit, startTrace, reportInteractions, { kind: "deferReply" }],
      ],
      state: { phase: "recording" },
    },
    {
      name: "once Playwright reports Interactions, the pages are asked to hold inputs back",
      happened: [opened, record, reporting],
      todo: [[holdInputs]],
      state: { phase: "recording" },
    },
    {
      name: "once the pages hold inputs back, Record is answered",
      happened: [opened, record, reporting, holding],
      todo: [[recordApplied]],
      state: { phase: "recording" },
    },
    {
      name: "the Visit Record starts is for the page as it is now, not as it opened",
      happened: [
        opened,
        { kind: "pageNavigated", page: "page_1", url: "http://shop.test/cart" },
        record,
      ],
      todo: [
        [
          {
            kind: "timeline",
            add: {
              kind: "visit",
              page: "page_1",
              url: "http://shop.test/cart",
              cause: "initial",
            },
          },
          startTrace,
          reportInteractions,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "recording" },
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
      happened: [opened, record, record, reporting, holding],
      todo: [[reply("ignored")], [holdInputs], [recordApplied]],
      state: { phase: "recording" },
    },
    {
      name: "a click held before every page has confirmed is recorded like any other",
      happened: [opened, record, reporting, clickHeld("input_1")],
      todo: [[takeSnapshot("snapshot_1")]],
      state: { phase: "recording" },
    },
    {
      name: "Finish before the pages hold inputs back answers Record, then wraps up",
      happened: [opened, record, finish, reporting, holding],
      todo: [[recordApplied, ...wrapUp, reply("applied")], [], []],
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
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), passOn("input_1")],
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), letThrough("input_1")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the Interaction is written down when Playwright's report arrives after the 'after'",
      happened: [opened, ...started, ...oneClick, reported],
      todo: [[interaction("snapshot_1", "snapshot_2")]],
      state: { phase: "recording" },
    },
    {
      name: "the Interaction is written down with its 'after' when the report came first",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1", 33),
        reported,
        settled("input_1"),
        taken("snapshot_2"),
      ],
      todo: [
        [],
        [takeSnapshot("snapshot_2")],
        [
          keep("snapshot_2"),
          interaction("snapshot_1", "snapshot_2", 33),
          letThrough("input_1"),
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
          page: "page_1",
          report: { ...click, type: "fill" },
        },
      ],
      todo: [[waitForSettled("reported_1")]],
      state: { phase: "recording" },
    },
    {
      name: "a second click waits while the first is given its 'before' and passed on, then one snapshot is the first's 'after' and the second's 'before'",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        clickHeld("input_2"),
        taken("snapshot_1"),
        passedOn("input_1"),
        taken("snapshot_2"),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), passOn("input_2")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click held while the page is still settling ends the wait: its 'before' is the earlier click's 'after'",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1"),
        clickHeld("input_2"),
        // The wait that was cut short ends later: nothing more is asked.
        settled("input_1"),
        taken("snapshot_2"),
      ],
      todo: [
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [],
        [keep("snapshot_2"), passOn("input_2")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a click held while the earlier click's 'after' is being taken gets a 'before' of its own",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1"),
        settled("input_1"),
        clickHeld("input_2"),
        taken("snapshot_2"),
        taken("snapshot_3"),
      ],
      todo: [
        [takeSnapshot("snapshot_2")],
        [],
        [keep("snapshot_2"), takeSnapshot("snapshot_3")],
        [keep("snapshot_3"), passOn("input_2")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "reports go to held clicks in the order the clicks were held",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1", 21),
        clickHeld("input_2"),
        taken("snapshot_2"),
        passedOn("input_2", 22),
        settled("input_2"),
        taken("snapshot_3"),
        reported,
        reported,
      ],
      todo: [
        [interaction("snapshot_1", "snapshot_2", 21)],
        [interaction("snapshot_2", "snapshot_3", 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a snapshot nobody waits for is not kept",
      happened: [opened, ...started, taken("snapshot_9")],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a click whose page closes before it is passed on is dropped",
      happened: [
        opened,
        { kind: "pageOpened", page: "page_2", url },
        ...started,
        clickHeld("input_1"),
        { kind: "pageClosed", page: "page_1", pagesLeft: 1 },
        taken("snapshot_1"),
      ],
      todo: [[takeSnapshot("snapshot_1")], [], []],
      state: { phase: "recording" },
    },
    {
      name: "a click whose page closes after it was passed on keeps its 'before' only",
      happened: [
        opened,
        { kind: "pageOpened", page: "page_2", url },
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1"),
        { kind: "pageClosed", page: "page_1", pagesLeft: 1 },
        reported,
      ],
      todo: [[], [interaction("snapshot_1", null)]],
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
        taken("snapshot_1"),
        traceStopped,
        saved,
      ],
      todo: [
        [keep("snapshot_1"), stopTrace],
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
      happened: [opened, ...started, finish, gateOff, taken("snapshot_1")],
      todo: [[keep("snapshot_1"), stopTrace]],
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
        taken("snapshot_3"),
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3"), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "Finish while a click is held: the click is passed on and is in the package",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        finish,
        gateOff,
        taken("snapshot_1"),
        passedOn("input_1"),
        settled("input_1"),
        taken("snapshot_2"),
        reported,
        taken("snapshot_3"),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [...wrapUp, reply("applied")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), takeSnapshot("snapshot_3")],
        [interaction("snapshot_1", "snapshot_2")],
        [keep("snapshot_3"), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a click held after Finish, before the pages confirm, is still passed on and recorded",
      happened: [
        opened,
        ...started,
        finish,
        clickHeld("input_1"),
        gateOff,
        taken("snapshot_1"),
        passedOn("input_1"),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [waitForSettled("input_1")],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the wrap-up waits for the report of a click that was already passed on",
      happened: [
        opened,
        ...started,
        ...oneClick,
        finish,
        gateOff,
        taken("snapshot_3"),
        reported,
      ],
      todo: [
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3")],
        [interaction("snapshot_1", "snapshot_2"), stopTrace],
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
        taken("snapshot_3"),
        { kind: "timeLimitPassed" },
      ],
      todo: [[keep("snapshot_3")], [stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "the time limit passing after the save has begun does nothing",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken("snapshot_1"),
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
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken("snapshot_1"),
        finish,
      ],
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
        taken("snapshot_1"),
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
        taken("snapshot_1"),
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
      todo: [[keep("snapshot_1"), stopReporting], []],
      state: { phase: "paused" },
    },
    {
      name: "Continue goes on in the trace that is running",
      happened: [...stopped, resume],
      todo: [[reportInteractions, { kind: "deferReply" }]],
      state: { phase: "recording" },
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
      todo: [[]],
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
      happened: [...stopped, clear, record],
      todo: [
        [startVisit, startTrace, reportInteractions, { kind: "deferReply" }],
      ],
      state: { phase: "recording" },
    },

    // A breakdown.
    {
      name: "a recorder that breaks down ends 'failed' with the reason",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken("snapshot_1"),
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
      happened: [opened, ...started, outsideEnd, gateOff, taken("snapshot_1")],
      todo: [
        wrapUp,
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), stopTrace],
      ],
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
        taken("snapshot_1"),
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
        { kind: "pageClosed", page: "page_1", pagesLeft: 0 },
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
        { kind: "pageOpened", page: "page_2", url: "http://shop.test/help" },
      ],
      todo: [[visitAt("http://shop.test/help", "openPage", "page_2")]],
      state: { phase: "recording" },
    },
    {
      name: "a page opened blank while recording starts its Visit at the first address it goes to",
      happened: [
        opened,
        ...started,
        { kind: "pageOpened", page: "page_2", url: "about:blank" },
        navigated("http://shop.test/help", "page_2"),
        navigated("http://shop.test/faq", "page_2"),
      ],
      todo: [
        [],
        [visitAt("http://shop.test/help", "openPage", "page_2")],
        [visitAt("http://shop.test/faq", "navigate", "page_2")],
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
        clickHeld("input_1"),
        clickHeld("input_2"),
        taken("snapshot_1"),
        navigated("http://shop.test/cart"),
        { kind: "inputGone", input: "input_1" },
        // A report of the click is of no held click any more.
        reported,
      ],
      todo: [
        [keep("snapshot_1"), passOn("input_1")],
        [visitAt("http://shop.test/cart", "navigate")],
        [takeSnapshot("snapshot_2")],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a held click whose document is gone while wrapping up is dropped, and the recording saves",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        finish,
        gateOff,
        { kind: "inputGone", input: "input_1" },
        taken("snapshot_2"),
      ],
      todo: [[takeSnapshot("snapshot_2")], [keep("snapshot_2"), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "a page that went elsewhere while paused starts a Visit there at Continue",
      happened: [...stopped, navigated("http://shop.test/cart"), resume],
      todo: [
        [],
        [
          visitAt("http://shop.test/cart", "navigate"),
          reportInteractions,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a page opened while paused starts a Visit of its own at Continue",
      happened: [
        ...stopped,
        { kind: "pageOpened", page: "page_2", url: "about:blank" },
        navigated("http://shop.test/help", "page_2"),
        resume,
      ],
      todo: [
        [],
        [],
        [
          visitAt("http://shop.test/help", "openPage", "page_2"),
          reportInteractions,
          { kind: "deferReply" },
        ],
      ],
      state: { phase: "recording" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(result.todo.slice(-todo.length)).toEqual(todo);
    expect(result.state).toEqual(state);
  });

  // Ticket #1273, the full lifecycle: Stop, Continue, Clear, and every way
  // out of each state. A row that is a bug path of the lifecycle model says
  // which rule of the spec it keeps.
  it.each<{
    name: string;
    happened: Happening[];
    /** The lists of the last steps, one per step. */
    todo: ToDo[][];
    state: RecorderPhase;
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
      happened: [opened, ...started, stop, gateOff, taken("snapshot_1")],
      todo: [[takeSnapshot("snapshot_1")], [keep("snapshot_1"), stopReporting]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the recorder is not paused before the pages confirm that they hold nothing back, whatever else is in (rule 3)",
      happened: [opened, ...started, stop, reportingOff, taken("snapshot_1")],
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
        clickHeld("input_1"),
        gateOff,
        taken("snapshot_1"),
        passedOn("input_1"),
        settled("input_1"),
        taken("snapshot_2"),
        reported,
        taken("snapshot_3"),
        reportingOff,
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), takeSnapshot("snapshot_3")],
        [interaction("snapshot_1", "snapshot_2")],
        [keep("snapshot_3"), stopReporting],
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
        taken("snapshot_3"),
        reported,
      ],
      todo: [
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3")],
        [interaction("snapshot_1", "snapshot_2"), stopReporting],
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
        taken("snapshot_3"),
        { kind: "timeLimitPassed" },
      ],
      todo: [[keep("snapshot_3")], [stopReporting]],
      state: { phase: "paused" },
    },
    {
      name: "when the time limit passes with a click still held, the click is passed on all the same (rule 1)",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        clickHeld("input_2"),
        stop,
        { kind: "timeLimitPassed" },
      ],
      todo: [[passOn("input_1"), passOn("input_2"), stopReporting]],
      state: { phase: "paused" },
    },
    {
      name: "when the time limit passes on a Finish with a click still held, the click is passed on before the save (rule 1)",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        finish,
        { kind: "timeLimitPassed" },
      ],
      todo: [[passOn("input_1"), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "the time limit passing while Playwright's recorder is switched off pauses at once",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken("snapshot_1"),
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
      happened: [
        ...stopped,
        clickHeld("input_1"),
        passedOn("input_1"),
        reported,
      ],
      todo: [[passOn("input_1")], [], []],
      state: { phase: "paused" },
    },
    {
      name: "a click a page held back before Record is passed on at once (rule 1)",
      happened: [opened, clickHeld("input_1")],
      todo: [[passOn("input_1")]],
      state: { phase: "notRecording" },
    },
    {
      name: "a click a page held back while the package is saved is passed on at once (rule 1)",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        taken("snapshot_1"),
        clickHeld("input_1"),
      ],
      todo: [[passOn("input_1")]],
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
      state: { phase: "recording" },
    },
    {
      name: "Continue is answered once the pages hold inputs back again",
      happened: [...stopped, resume, reporting, holding],
      todo: [[holdInputs], [recordApplied]],
      state: { phase: "recording" },
    },
    {
      name: "after Continue the snapshots go on counting: the timeline is the same one, and a 'before' comes after every earlier 'after' (rule 12)",
      happened: [...stopped, resume, reporting, holding, clickHeld("input_1")],
      todo: [[takeSnapshot("snapshot_2")]],
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
        taken("snapshot_3"),
        reportingOff,
      ],
      todo: [
        [...wrapUp, reply("applied")],
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3"), stopReporting],
        [discardTrace, { kind: "clear" }],
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
        taken("snapshot_3"),
        reported,
      ],
      todo: [
        [keep("snapshot_3")],
        [interaction("snapshot_1", "snapshot_2"), stopReporting],
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
        taken("snapshot_3"),
        { kind: "timeLimitPassed" },
        reported,
        ...started,
        reported,
      ],
      todo: [
        [stopReporting, discardTrace, { kind: "clear" }],
        [],
        [startVisit, startTrace, reportInteractions, { kind: "deferReply" }],
        [holdInputs],
        [recordApplied],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Clear while paused throws everything away at once",
      happened: [...stopped, clear],
      todo: [[discardTrace, { kind: "clear" }, reply("applied")]],
      state: { phase: "notRecording" },
    },
    {
      name: "after Clear, Record starts a recording of its own: a new Visit, and the first snapshot",
      happened: [...stopped, clear, ...started, clickHeld("input_1")],
      todo: [
        [startVisit, startTrace, reportInteractions, { kind: "deferReply" }],
        [holdInputs],
        [recordApplied],
        [takeSnapshot("snapshot_1")],
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
      happened: [
        ...stopped,
        { kind: "pageClosed", page: "page_1", pagesLeft: 0 },
      ],
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
        taken("snapshot_1"),
      ],
      todo: [[], [takeSnapshot("snapshot_1")], [keep("snapshot_1"), stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while Playwright's recorder is switched off after Stop saves once that is done",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken("snapshot_1"),
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
        taken("snapshot_1"),
      ],
      todo: [
        [],
        [takeSnapshot("snapshot_1")],
        [
          keep("snapshot_1"),
          discardTrace,
          { kind: "clear" },
          { kind: "end", outcome: { kind: "empty" } },
        ],
      ],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },
    {
      name: "an outside end after Clear ends with 'empty'",
      happened: [...stopped, clear, outsideEnd],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // A request the browser could not carry out: nothing waits for ever.
    {
      name: "Record is answered 'ignored' and the recorder ends 'failed' when Playwright's recorder cannot be started",
      happened: [opened, record, failed(reportInteractions)],
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
      happened: [opened, record, reporting, failed(holdInputs)],
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
      todo: [[takeSnapshot("snapshot_1")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "the recorder pauses also when Playwright's recorder cannot be switched off: its reports are ignored from then on",
      happened: [
        opened,
        ...started,
        stop,
        gateOff,
        taken("snapshot_1"),
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
        clickHeld("input_1"),
        failed(takeSnapshot("snapshot_1")),
        passedOn("input_1"),
        settled("input_1"),
        taken("snapshot_2"),
        reported,
      ],
      todo: [
        [passOn("input_1")],
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), letThrough("input_1")],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the report of a click that could not be recorded is not taken for the next click's (rule 13)",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        failed(takeSnapshot("snapshot_1")),
        passedOn("input_1"),
        clickHeld("input_2"),
        taken("snapshot_2"),
        passedOn("input_2", 22),
        settled("input_2"),
        taken("snapshot_3"),
        reported,
        reported,
      ],
      todo: [[], [interaction("snapshot_2", "snapshot_3", 22)]],
      state: { phase: "recording" },
    },
    {
      name: "a click whose 'after' cannot be taken keeps its 'before' only",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1"),
        settled("input_1"),
        reported,
        failed(takeSnapshot("snapshot_2")),
      ],
      todo: [[interaction("snapshot_1", null), letThrough("input_1")]],
      state: { phase: "recording" },
    },
    {
      name: "a last snapshot that cannot be taken is left out: the wrap-up goes on",
      happened: [
        opened,
        ...started,
        finish,
        gateOff,
        failed(takeSnapshot("snapshot_1")),
      ],
      todo: [[stopTrace]],
      state: { phase: "saving" },
    },
    {
      name: "a click that cannot be passed on is dropped, and the next one of its page goes on",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        clickHeld("input_2"),
        taken("snapshot_1"),
        failed(passOn("input_1")),
        reported,
      ],
      todo: [[takeSnapshot("snapshot_2")], []],
      state: { phase: "recording" },
    },
    {
      name: "a wait for a Settled Page that breaks is over: the 'after' is taken",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        taken("snapshot_1"),
        passedOn("input_1"),
        failed(waitForSettled("input_1")),
      ],
      todo: [[takeSnapshot("snapshot_2")]],
      state: { phase: "recording" },
    },
    {
      name: "a request that failed when nothing is recorded any more changes nothing",
      happened: [
        ...stopped,
        failed(takeSnapshot("snapshot_1")),
        failed(passOn("input_1")),
        failed(stopReporting),
        failed(wrapUp[0]!),
      ],
      todo: [[], [], [], []],
      state: { phase: "paused" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(result.todo.slice(-todo.length)).toEqual(todo);
    expect(result.state).toEqual(state);
  });

  it("saves once, however often Finish is pressed", () => {
    const { todo } = run([
      opened,
      ...started,
      finish,
      finish,
      gateOff,
      finish,
      taken("snapshot_1"),
      finish,
      traceStopped,
      saved,
      finish,
    ]);

    expect(todo.flat().filter((item) => item.kind === "save")).toHaveLength(1);
    expect(todo.flat().filter((item) => item.kind === "end")).toHaveLength(1);
  });
});

// Every kind of input: clicks of more than one count, key presses, typing,
// and the inputs Playwright reports that the gate never holds.
describe("the lifecycle, for every kind of input", () => {
  const held = (input: string, what: HeldInput): Happening => ({
    kind: "inputHeld",
    input,
    page: "page_1",
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
    page: "page_1",
    report,
  });
  const fromReport = (
    report: InteractionReport,
    before: string,
    after: string
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: {
        page: "page_1",
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
    page: "page_1",
    report,
  });
  const written = (
    report: InteractionReport,
    before: string,
    after: string | null,
    at = 20
  ): ToDo => ({
    kind: "timeline",
    add: {
      kind: "interaction",
      interaction: { page: "page_1", report, before, after, at },
    },
  });
  /** Two clicks of one double click, from held to settled. */
  const doubleClick = [
    held("input_1", { kind: "click", count: 1 }),
    held("input_2", { kind: "click", count: 2 }),
    taken("snapshot_1"),
    passedOn("input_1", 21),
    taken("snapshot_2"),
    passedOn("input_2", 22),
    settled("input_2"),
    taken("snapshot_3"),
  ];

  it.each<{
    name: string;
    happened: Happening[];
    todo: ToDo[][];
    state: RecorderPhase;
  }>([
    {
      name: "one report of a double click covers both held clicks: one Interaction from the first's 'before' to the second's 'after'",
      happened: [opened, ...started, ...doubleClick, reportedAs(clickOf(2))],
      todo: [[written(clickOf(2), "snapshot_1", "snapshot_3", 21)]],
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
        [written(clickOf(1), "snapshot_1", "snapshot_2", 21)],
        [written(clickOf(2), "snapshot_2", "snapshot_3", 22)],
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
        taken("snapshot_4"),
        reportedAs(clickOf(2)),
      ],
      todo: [
        [keep("snapshot_4")],
        [written(clickOf(2), "snapshot_1", "snapshot_3", 21), stopTrace],
      ],
      state: { phase: "saving" },
    },
    {
      name: "a held key press gets its 'before', is passed on, and is written down with its report",
      happened: [
        opened,
        ...started,
        held("input_1", { kind: "press" }),
        taken("snapshot_1"),
        passedOn("input_1"),
        settled("input_1"),
        taken("snapshot_2"),
        reportedAs(enter),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), passOn("input_1")],
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), letThrough("input_1")],
        [written(enter, "snapshot_1", "snapshot_2")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a key press held while a click is held waits behind the click, and each report goes to its own kind of input",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        held("input_2", { kind: "press" }),
        taken("snapshot_1"),
        passedOn("input_1", 21),
        taken("snapshot_2"),
        passedOn("input_2", 22),
        settled("input_2"),
        taken("snapshot_3"),
        reported,
        reportedAs(enter),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), passOn("input_2")],
        [waitForSettled("input_2")],
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3"), letThrough("input_2")],
        [interaction("snapshot_1", "snapshot_2", 21)],
        [written(enter, "snapshot_2", "snapshot_3", 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a held click whose report never comes is left out once a later input is reported: reports come in order",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        held("input_2", { kind: "press" }),
        taken("snapshot_1"),
        passedOn("input_1", 21),
        taken("snapshot_2"),
        passedOn("input_2", 22),
        settled("input_2"),
        taken("snapshot_3"),
        reportedAs(enter),
      ],
      todo: [[written(enter, "snapshot_2", "snapshot_3", 22)]],
      state: { phase: "recording" },
    },

    // Typing waits behind a held input.
    {
      name: "a key typed while a click is held waits: the click's 'after' is taken before the typing reaches the page, which gets no snapshot or wait of its own",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        held("input_2", { kind: "typing" }),
        taken("snapshot_1"),
        passedOn("input_1", 21),
        taken("snapshot_2"),
        passedOn("input_2", 22),
        reported,
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), passOn("input_2")],
        [letThrough("input_2")],
        [interaction("snapshot_1", "snapshot_2", 21)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "keys typed one after another while held are passed on in order, with no snapshot between them",
      happened: [
        opened,
        ...started,
        clickHeld("input_1"),
        held("input_2", { kind: "typing" }),
        held("input_3", { kind: "typing" }),
        taken("snapshot_1"),
        passedOn("input_1"),
        taken("snapshot_2"),
        passedOn("input_2"),
        passedOn("input_3"),
      ],
      todo: [
        [keep("snapshot_2"), passOn("input_2")],
        [passOn("input_3")],
        [letThrough("input_3")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "after Record a page holds what follows until its first input has a 'before': a key typed first gets one, then the page lets inputs through",
      happened: [
        opened,
        ...started,
        held("input_1", { kind: "typing" }),
        taken("snapshot_1"),
        passedOn("input_1"),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), passOn("input_1")],
        [letThrough("input_1")],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a page lets inputs through once a held click has its 'after' and nothing else is held",
      happened: [opened, ...started, ...oneClick],
      todo: [
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), passOn("input_1")],
        [waitForSettled("input_1")],
        [takeSnapshot("snapshot_2")],
        [keep("snapshot_2"), letThrough("input_1")],
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
        settled("reported_1"),
        taken("snapshot_3"),
        clickHeld("input_2"),
      ],
      todo: [
        [waitForSettled("reported_1")],
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3")],
        [
          takeSnapshot("snapshot_4"),
          fromReport(fill("m"), "snapshot_2", "snapshot_3"),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "the wrap-up writes typing that has its 'after'",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled("reported_1"),
        taken("snapshot_3"),
        finish,
      ],
      todo: [
        [
          ...wrapUp,
          fromReport(fill("m"), "snapshot_2", "snapshot_3"),
          reply("applied"),
        ],
      ],
      state: { phase: "wrappingUp" },
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
        settled("reported_1"),
        taken("snapshot_3"),
        finish,
      ],
      todo: [
        [
          ...wrapUp,
          fromReport(fill("milk"), "snapshot_2", "snapshot_3"),
          reply("applied"),
        ],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "typing revised after its 'after' was taken waits for the page again, and ends at the newer snapshot",
      happened: [
        opened,
        ...started,
        ...oneClick,
        reported,
        reportedAs(fill("m")),
        settled("reported_1"),
        taken("snapshot_3"),
        revised(fill("milk")),
        settled("reported_1"),
        taken("snapshot_4"),
        finish,
      ],
      todo: [
        [waitForSettled("reported_1")],
        [takeSnapshot("snapshot_4")],
        [keep("snapshot_4")],
        [
          ...wrapUp,
          fromReport(fill("milk"), "snapshot_2", "snapshot_4"),
          reply("applied"),
        ],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a reported select with no snapshot of its page yet gets one to start from",
      happened: [opened, ...started, reportedAs(choose), taken("snapshot_1")],
      todo: [
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), waitForSettled("reported_1"), letThrough(null)],
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
        clickHeld("input_2"),
        taken("snapshot_3"),
      ],
      todo: [
        [waitForSettled("reported_1")],
        [takeSnapshot("snapshot_3")],
        [
          keep("snapshot_3"),
          passOn("input_2"),
          fromReport(fill("m"), "snapshot_2", "snapshot_3"),
        ],
      ],
      state: { phase: "recording" },
    },
    {
      name: "typing reported after a key press was held behind it ends where the press starts, and is written before it",
      happened: [
        opened,
        ...started,
        held("input_1", { kind: "typing" }),
        held("input_2", { kind: "press" }),
        taken("snapshot_1"),
        passedOn("input_1"),
        reportedAs(fill("m")),
        taken("snapshot_2"),
        passedOn("input_2", 22),
        settled("input_2"),
        taken("snapshot_3"),
        reportedAs(enter),
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [],
        [keep("snapshot_1"), passOn("input_1")],
        [takeSnapshot("snapshot_2")],
        [],
        [
          keep("snapshot_2"),
          passOn("input_2"),
          fromReport(fill("m"), "snapshot_1", "snapshot_2"),
        ],
        [waitForSettled("input_2")],
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3"), letThrough("input_2")],
        [written(enter, "snapshot_2", "snapshot_3", 22)],
      ],
      state: { phase: "recording" },
    },
    {
      name: "a choice reported while the key press that made it waits for its Settled Page starts from the press's 'after'",
      happened: [
        opened,
        ...started,
        held("input_1", { kind: "press" }),
        taken("snapshot_1"),
        passedOn("input_1"),
        reportedAs(choose),
        settled("input_1"),
        taken("snapshot_2"),
        settled("reported_1"),
        taken("snapshot_3"),
        finish,
      ],
      todo: [
        [],
        [takeSnapshot("snapshot_2")],
        [
          keep("snapshot_2"),
          waitForSettled("reported_1"),
          letThrough("input_1"),
        ],
        [takeSnapshot("snapshot_3")],
        [keep("snapshot_3")],
        [
          ...wrapUp,
          fromReport(choose, "snapshot_2", "snapshot_3"),
          reply("applied"),
        ],
      ],
      state: { phase: "wrappingUp" },
    },
    {
      name: "a key pressed with nothing focused is written with no target, whatever element Playwright names",
      happened: [
        opened,
        ...started,
        held("input_1", { kind: "press", nothingFocused: true }),
        taken("snapshot_1"),
        passedOn("input_1"),
        settled("input_1"),
        taken("snapshot_2"),
        reportedAs({
          ...enter,
          target: { ref: "e1", tree: "- generic [ref=e1]" },
        }),
      ],
      todo: [[written({ ...enter, target: null }, "snapshot_1", "snapshot_2")]],
      state: { phase: "recording" },
    },
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(result.todo.slice(-todo.length)).toEqual(todo);
    expect(result.state).toEqual(state);
  });
});

// Follow-ups to every kind of input.
describe("the lifecycle, for a page that is blank at Record", () => {
  const blank: Happening = {
    kind: "pageOpened",
    page: "page_1",
    url: "about:blank",
  };

  it("starts no Visit for it, and starts its Visit, as the first, at its first real address", () => {
    const { todo, state } = run([
      blank,
      record,
      { kind: "pageNavigated", page: "page_1", url },
    ]);

    expect(todo.at(-2)).toEqual([
      startTrace,
      reportInteractions,
      { kind: "deferReply" },
    ]);
    expect(todo.at(-1)).toEqual([startVisit]);
    expect(state).toEqual({ phase: "recording" });
  });
});

describe("the lifecycle, for a click made while the recorder wraps up", () => {
  const clickReport = (count: number): InteractionReport => ({
    ...click,
    values: { button: "left", clickCount: count },
  });
  const reportedClick = (count: number): Happening => ({
    kind: "interactionReported",
    page: "page_1",
    report: clickReport(count),
  });
  /** Stop, up to Playwright's recorder being switched off. */
  const stopping = [opened, ...started, stop, gateOff, taken("snapshot_1")];

  it("records a click the pages no longer held from Playwright's report alone, before the recorder is paused", () => {
    const { todo, state } = run([
      ...stopping,
      reportedClick(1),
      settled("reported_1"),
      taken("snapshot_2"),
      reportingOff,
    ]);

    expect(todo.slice(-4)).toEqual([
      [waitForSettled("reported_1")],
      [takeSnapshot("snapshot_2")],
      [
        keep("snapshot_2"),
        {
          kind: "timeline",
          add: {
            kind: "interaction",
            interaction: {
              page: "page_1",
              report: clickReport(1),
              before: "snapshot_1",
              after: "snapshot_2",
              at: 10,
              beforeFromReport: true,
            },
          },
        },
      ],
      [],
    ]);
    expect(state).toEqual({ phase: "paused" });
  });

  it("waits for such a click when Playwright's recorder is switched off before it has its 'after'", () => {
    const { todo, state } = run([
      ...stopping,
      reportedClick(1),
      reportingOff,
      settled("reported_1"),
      taken("snapshot_2"),
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
