import type {
  RecorderCommandType,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { entryCardOf } from "./entryCard";

// How one entry of a Visit shows in the window: read from the entry and from
// the commands that apply now.

const click: TimelineEntry = {
  kind: "interaction",
  id: "interaction_1",
  timestamp: 10,
  interaction: {
    id: "interaction_1",
    type: "click",
    targetRef: "e2",
    targetSelector: 'internal:role=button[name="Add item"i]',
  },
  changeTree: [
    "- [ref=e1]:",
    '  - <added> [ref=e3] list "Cart":',
    "    - <added> [ref=e4] listitem: Milk",
  ].join("\n"),
};
const change: TimelineEntry = {
  kind: "change",
  id: "change_1",
  timestamp: 20,
  changeTree: '- [ref=e1]:\n  - <removed> [ref=e5] status: "Saved"',
};
const recording: RecorderCommandType[] = [
  "finish",
  "stop",
  "clear",
  "highlight",
  "clearHighlight",
];
const paused: RecorderCommandType[] = [
  "finish",
  "continue",
  "clear",
  "discard",
  "restore",
];

describe("an entry's card", () => {
  it("names an Interaction, its target and the roots of what it changed", () => {
    expect(entryCardOf(click, recording)).toEqual({
      icon: "click",
      title: "Click",
      target: 'button "Add item"',
      discarded: false,
      review: null,
      hover: {
        enter: { type: "highlight", entry: "interaction_1" },
        leave: { type: "clearHighlight" },
      },
      changes: [{ element: 'list "Cart"', effect: "appeared" }],
    });
  });

  it("names a change no Interaction made, with no target", () => {
    expect(entryCardOf(change, recording)).toMatchObject({
      icon: "change",
      title: "Change without an Interaction",
      target: null,
      changes: [{ element: 'status "Saved"', effect: "was removed" }],
    });
  });

  it("gives an Interaction of a kind it has no icon for the one for any", () => {
    expect(
      entryCardOf(
        { ...click, interaction: { ...click.interaction, type: "uncheck" } },
        recording
      ).icon
    ).toBe("interaction");
  });

  it("says that a change changed what it changed", () => {
    expect(
      entryCardOf(
        { ...change, changeTree: '- <changed> [ref=e5] status: "Saving"' },
        recording
      ).changes
    ).toEqual([{ element: 'status "Saving"', effect: "changed" }]);
  });

  it("offers Discard while paused, and no highlight when it does not apply", () => {
    expect(entryCardOf(click, paused)).toMatchObject({
      review: {
        label: "Discard",
        command: { type: "discard", entry: "interaction_1" },
      },
      hover: { enter: null, leave: null },
    });
  });

  it("dims a discarded entry, hides what it changed and offers Restore", () => {
    expect(entryCardOf({ ...click, discarded: true }, paused)).toMatchObject({
      discarded: true,
      review: {
        label: "Restore",
        command: { type: "restore", entry: "interaction_1" },
      },
      changes: [],
    });
  });

  it("offers neither Discard nor Restore when they do not apply", () => {
    expect(entryCardOf({ ...click, discarded: true }, recording).review).toBe(
      null
    );
  });

  it("lists no changes for an Interaction that changed nothing", () => {
    expect(
      entryCardOf({ ...click, changeTree: null }, recording).changes
    ).toEqual([]);
  });
});
