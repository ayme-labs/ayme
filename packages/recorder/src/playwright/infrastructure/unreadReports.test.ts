import { describe, expect, it } from "vitest";

import {
  bareReportOf,
  readInPart,
  reportLost,
  revisionLost,
  toldOfUnread,
  withoutElement,
} from "./unreadReports";

describe("a report of Playwright's the adapter could not read", () => {
  it("is told bare: its type and what Playwright said of the input, with no element", () => {
    expect(
      bareReportOf({
        name: "click",
        selector: 'internal:role=button[name="Save"i]',
        ref: "e2",
        ariaSnapshot: '- button "Save" [ref=e2]',
        signals: [],
        button: "left",
        clickCount: 1,
        modifiers: 0,
        trial: false,
        position: { x: 3, y: 4 },
      })
    ).toEqual({
      type: "click",
      selector: null,
      target: null,
      values: { button: "left", clickCount: 1, modifiers: 0, trial: false },
    });
  });

  it("keeps a choice's options and an upload's files, lists of plain values", () => {
    expect(
      bareReportOf({ name: "select", selector: "#size", options: ["M", "L"] })
    ).toEqual({
      type: "select",
      selector: null,
      target: null,
      values: { options: ["M", "L"] },
    });
    expect(
      bareReportOf({
        name: "setInputFiles",
        files: ["a.txt", "b.txt"],
        mixed: ["a", { b: 1 }],
      })?.values
    ).toEqual({ files: ["a.txt", "b.txt"] });
  });

  it("is told by nothing when even that cannot be read off it", () => {
    const action = { name: "click" };
    Object.defineProperty(action, "button", {
      enumerable: true,
      get() {
        throw new Error("Not readable.");
      },
    });
    expect(bareReportOf(action)).toBeUndefined();
  });
});

describe("what a person is told of a report the adapter could not read", () => {
  const failed = new Error("Cannot read properties of null.");

  it("says the step is in the recording without its element", () => {
    expect(withoutElement("click", failed)).toEqual({
      kind: "notRecorded",
      message:
        "A step is in the recording without its element: the recorder could not read Playwright's report of a click. The recorder's error: Cannot read properties of null.",
    });
  });

  it("says the step is in the recording as Playwright reported it, when what the adapter reads of the page besides failed", () => {
    expect(readInPart("setInputFiles", failed).message).toBe(
      "A step is in the recording as Playwright reported it, without what the recorder reads of the page besides: the recorder could not finish reading the setInputFiles. The recorder's error: Cannot read properties of null."
    );
  });

  it("says typing may lack its latest keys when a revision is lost", () => {
    expect(revisionLost(failed).message).toBe(
      "Typing may be missing its latest keys in the recording: the recorder could not read Playwright's revision of it. The trace still holds them. The recorder's error: Cannot read properties of null."
    );
  });

  it("says a step may be missing when the report could not be read at all, also for an error that cannot be shown", () => {
    expect(reportLost(Object.create(null)).message).toBe(
      "A step may be missing from the recording: the recorder could not read a report of Playwright's. The trace still holds it. The recorder's error: an error that cannot be shown"
    );
  });

  it("says so of an error whose message is no text", () => {
    const symbolic = Object.assign(new Error(), {
      message: Symbol("message"),
    });
    expect(reportLost(symbolic).message).toMatch(
      /The recorder's error: an error that cannot be shown$/
    );
  });
});

describe("what is told of a report that could not be read", () => {
  const cause = new Error("It broke.");
  const click = { name: "click", button: "left", clickCount: 1 };

  it("is the report told bare, with a warning that it has no element, for a report of an open page", () => {
    expect(
      toldOfUnread(true, { action: click, revision: false, cause })
    ).toEqual({
      warning: withoutElement("click", cause),
      report: {
        type: "click",
        selector: null,
        target: null,
        values: { button: "left", clickCount: 1 },
      },
    });
  });

  it("is a warning alone for a revision, a report of no open page, or one that could not be decoded", () => {
    expect(
      toldOfUnread(true, { action: click, revision: true, cause })
    ).toEqual({ warning: revisionLost(cause) });
    expect(
      toldOfUnread(false, { action: click, revision: false, cause })
    ).toEqual({ warning: reportLost(cause) });
    expect(
      toldOfUnread(true, { action: undefined, revision: false, cause })
    ).toEqual({ warning: reportLost(cause) });
  });
});
