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
const reporting: Happening = { kind: "reportingInteractions" };
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
  ask: { kind: "reportInteractions" },
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
        [written(clickOf(2), "snapshot_1", "snapshot_3", 21), save],
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
        [keep("snapshot_2")],
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
        [keep("snapshot_3")],
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
  ])("$name", ({ happened, todo, state }) => {
    const result = run(happened);
    expect(result.todo.slice(-todo.length)).toEqual(todo);
    expect(result.state).toEqual(state);
  });
});
