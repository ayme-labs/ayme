import { describe, expect, it } from "vitest";

import {
  initialState,
  step,
  type Happening,
  type LifecycleState,
} from "./lifecycle";

const notRecording: LifecycleState = { phase: "notRecording" };
const endedEmpty: LifecycleState = {
  phase: "ended",
  outcome: { kind: "empty" },
};

describe("the lifecycle", () => {
  it("starts not recording", () => {
    expect(initialState).toEqual(notRecording);
  });

  it.each<{
    name: string;
    from: LifecycleState;
    happening: Happening;
    to: LifecycleState;
    todo: ReturnType<typeof step>["todo"];
  }>([
    {
      name: "an outside end before anything was recorded ends with 'empty'",
      from: notRecording,
      happening: { kind: "outsideEnd" },
      to: endedEmpty,
      todo: [{ kind: "end", outcome: { kind: "empty" } }],
    },
    {
      name: "closing the last page is an outside end",
      from: notRecording,
      happening: { kind: "pageClosed", pagesLeft: 0 },
      to: endedEmpty,
      todo: [{ kind: "end", outcome: { kind: "empty" } }],
    },
    {
      name: "closing a page while another is open changes nothing",
      from: notRecording,
      happening: { kind: "pageClosed", pagesLeft: 1 },
      to: notRecording,
      todo: [],
    },
    {
      name: "a browser that disappears is an outside end",
      from: notRecording,
      happening: { kind: "browserGone" },
      to: endedEmpty,
      todo: [{ kind: "end", outcome: { kind: "empty" } }],
    },
    {
      name: "a second outside end does nothing",
      from: endedEmpty,
      happening: { kind: "outsideEnd" },
      to: endedEmpty,
      todo: [],
    },
    {
      name: "the browser going away after the end does nothing",
      from: endedEmpty,
      happening: { kind: "browserGone" },
      to: endedEmpty,
      todo: [],
    },
    {
      name: "Finish with nothing recorded is ignored",
      from: notRecording,
      happening: { kind: "command", command: { type: "finish" } },
      to: notRecording,
      todo: [{ kind: "reply", result: "ignored" }],
    },
    {
      name: "a command after the end is ignored",
      from: endedEmpty,
      happening: { kind: "command", command: { type: "finish" } },
      to: endedEmpty,
      todo: [{ kind: "reply", result: "ignored" }],
    },
  ])("$name", ({ from, happening, to, todo }) => {
    expect(step(from, happening)).toEqual({ state: to, todo });
  });
});
