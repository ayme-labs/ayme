import { describe, expect, it } from "vitest";

import type { RecorderState } from "../../contract";
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
const startRecording: ToDo[] = [
  {
    kind: "timeline",
    add: { kind: "visit", page: "page_1", url, cause: "initial" },
  },
  { kind: "browser", ask: { kind: "reportInteractions" } },
  { kind: "browser", ask: { kind: "holdInputs", on: true } },
  reply("applied"),
];
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
    state: RecorderState;
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
      name: "Record starts a Visit for the open page, has Interactions reported, then holds inputs",
      happened: [opened, record],
      todo: [startRecording],
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
          ...startRecording.slice(1),
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
      happened: [opened, record, record],
      todo: [[reply("ignored")]],
      state: { phase: "recording" },
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
      happened: [opened, record, ...oneClick],
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
      happened: [opened, record, ...oneClick, reported],
      todo: [[interaction("snapshot_1", "snapshot_2")]],
      state: { phase: "recording" },
    },
    {
      name: "the Interaction is written down with its 'after' when the report came first",
      happened: [
        opened,
        record,
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
      happened: [opened, record, reported],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a report of an input the gate does not hold claims no held click",
      happened: [
        opened,
        record,
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
        record,
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
        record,
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
        record,
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
        record,
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
      happened: [opened, record, taken("snapshot_9")],
      todo: [[]],
      state: { phase: "recording" },
    },
    {
      name: "a click whose page closes before it is passed on is dropped",
      happened: [
        opened,
        { kind: "pageOpened", page: "page_2", url },
        record,
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
        record,
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
      happened: [opened, record, finish],
      todo: [[...wrapUp, reply("applied")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "once the pages confirm that no input is held, the wrap-up takes a last snapshot, then saves",
      happened: [opened, record, finish, gateOff, taken("snapshot_1"), saved],
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
      happened: [opened, record, finish, gateOff, taken("snapshot_1")],
      todo: [[keep("snapshot_1"), save]],
      state: { phase: "saving" },
    },
    {
      name: "Finish after a recorded click saves once the last snapshot is in",
      happened: [
        opened,
        record,
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
        record,
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
        record,
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
        record,
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
        record,
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
        record,
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
      happened: [opened, record, finish, finish],
      todo: [[reply("ignored")]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "Finish pressed twice saves once: the second is ignored while saving",
      happened: [opened, record, finish, gateOff, taken("snapshot_1"), finish],
      todo: [[reply("ignored")]],
      state: { phase: "saving" },
    },
    {
      name: "Finish after the package is saved is ignored",
      happened: [
        opened,
        record,
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
        record,
        finish,
        gateOff,
        taken("snapshot_1"),
        { kind: "saved", folder: null },
      ],
      todo: [[{ kind: "end", outcome: { kind: "empty" } }]],
      state: { phase: "ended", outcome: { kind: "empty" } },
    },

    // An end from outside while recording.
    {
      name: "an outside end while recording wraps up and saves, as Finish does",
      happened: [opened, record, outsideEnd, gateOff, taken("snapshot_1")],
      todo: [wrapUp, [takeSnapshot("snapshot_1")], [keep("snapshot_1"), save]],
      state: { phase: "saving" },
    },
    {
      name: "an outside end while wrapping up joins the wrap-up already running",
      happened: [opened, record, finish, outsideEnd],
      todo: [[]],
      state: { phase: "wrappingUp" },
    },
    {
      name: "an outside end while saving joins the save already running",
      happened: [
        opened,
        record,
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
        record,
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
      record,
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
