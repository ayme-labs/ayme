import { describe, expect, it } from "vitest";

import type { RecorderPhase } from "../../contract";
import type { InteractionReport, PageSnapshot } from "../../timeline/domain";
import {
  initialState,
  shown,
  step,
  WRAP_UP_LIMIT_MS,
  type Happening,
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
const save: ToDo = { kind: "save" };

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
      todo: [[startVisit, reportInteractions, { kind: "deferReply" }]],
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
        [keep("snapshot_2")],
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
        [keep("snapshot_2"), interaction("snapshot_1", "snapshot_2", 33)],
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
      todo: [[]],
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
        saved,
      ],
      todo: [
        [takeSnapshot("snapshot_1")],
        [keep("snapshot_1"), save],
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
      todo: [[keep("snapshot_1"), save]],
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
        [keep("snapshot_3"), save],
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
        [keep("snapshot_3"), save],
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
        [interaction("snapshot_1", "snapshot_2"), save],
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
      todo: [[keep("snapshot_3")], [save]],
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
        { kind: "saved", folder: null },
      ],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
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
      todo: [wrapUp, [takeSnapshot("snapshot_1")], [keep("snapshot_1"), save]],
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
      todo: [wrapUp, [save]],
      state: { phase: "saving" },
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
      todo: [[passOn("input_1"), save]],
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
        [stopReporting, { kind: "clear" }],
        [],
        [startVisit, reportInteractions, { kind: "deferReply" }],
        [holdInputs],
        [recordApplied],
        [],
      ],
      state: { phase: "recording" },
    },
    {
      name: "Clear while paused throws everything away at once",
      happened: [...stopped, clear],
      todo: [[{ kind: "clear" }, reply("applied")]],
      state: { phase: "notRecording" },
    },
    {
      name: "after Clear, Record starts a recording of its own: a new Visit, and the first snapshot",
      happened: [...stopped, clear, ...started, clickHeld("input_1")],
      todo: [
        [startVisit, reportInteractions, { kind: "deferReply" }],
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
      todo: [[reply("applied"), save]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while paused saves what was recorded",
      happened: [...stopped, outsideEnd, outsideEnd],
      todo: [[save], []],
      state: { phase: "saving" },
    },
    {
      name: "closing the last page while paused saves what was recorded",
      happened: [
        ...stopped,
        { kind: "pageClosed", page: "page_1", pagesLeft: 0 },
      ],
      todo: [[save]],
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
      todo: [[], [takeSnapshot("snapshot_1")], [keep("snapshot_1"), save]],
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
      todo: [[], [save]],
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
        [reply("applied"), save],
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
        [keep("snapshot_2")],
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
      todo: [[interaction("snapshot_1", null)]],
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
      todo: [[save]],
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
      saved,
      finish,
    ]);

    expect(todo.flat().filter((item) => item.kind === "save")).toHaveLength(1);
    expect(todo.flat().filter((item) => item.kind === "end")).toHaveLength(1);
  });
});
