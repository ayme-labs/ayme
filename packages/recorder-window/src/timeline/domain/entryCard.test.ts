import type {
  RecorderCommandType,
  TimelineEntry,
} from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { entryCardOf } from "./entryCard";
import { entryId } from "../../test-utils/ids";

// How one entry of a Visit shows in the window: read from the entry, from
// the commands that apply now, and from whether its Visit is the page now
// open.

const click: TimelineEntry = {
  kind: "interaction",
  id: entryId("interaction_1"),
  timestamp: 10,
  interaction: {
    id: entryId("interaction_1"),
    type: "click",
    targetRef: "e2",
    targetSelector: '[data-test="add-to-cart"]',
  },
  targetElement: 'button "Add to cart"',
  changes: [
    { kind: "added", element: 'button "Remove"' },
    {
      kind: "changed",
      element: 'link "Cart"',
      changed: [{ property: "name", from: "Cart", to: "Cart, 1 item" }],
    },
  ],
};
const change: TimelineEntry = {
  kind: "change",
  id: entryId("change_1"),
  timestamp: 20,
  changes: [{ kind: "removed", element: 'status "Saved"' }],
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
  "highlight",
  "clearHighlight",
];

describe("an entry's card", () => {
  it("names an Interaction, its target and the roots of what it changed, each of which can highlight its element", () => {
    expect(entryCardOf(click, recording)).toEqual({
      icon: "click",
      title: "Click",
      target: {
        text: "button “Add to cart”",
        hint: '[data-test="add-to-cart"]',
        highlight: { type: "highlight", entry: entryId("interaction_1") },
      },
      leave: { type: "clearHighlight" },
      discarded: false,
      discard: null,
      restore: null,
      changes: [
        {
          chip: {
            text: "button “Remove”",
            highlight: {
              type: "highlight",
              entry: entryId("interaction_1"),
              row: 0,
            },
          },
          effect: "appeared",
        },
        {
          chip: {
            text: "link “Cart”",
            highlight: {
              type: "highlight",
              entry: entryId("interaction_1"),
              row: 1,
            },
          },
          effect: "name changed from “Cart” to “Cart, 1 item”",
        },
      ],
    });
  });

  it("asks to highlight the target by its entry alone, naming no row", () => {
    expect(entryCardOf(click, recording).target?.highlight).toStrictEqual({
      type: "highlight",
      entry: entryId("interaction_1"),
    });
  });

  it("shows the selector of a target the page's structure does not name", () => {
    const unnamed = { ...click } as Extract<
      TimelineEntry,
      { kind: "interaction" }
    >;
    Reflect.deleteProperty(unnamed, "targetElement");
    expect(entryCardOf(unnamed, recording).target).toEqual({
      text: '[data-test="add-to-cart"]',
      highlight: { type: "highlight", entry: entryId("interaction_1") },
    });
  });

  it("shows the target's ref when it has no selector either, and no target with neither", () => {
    const bare = {
      ...click,
      targetElement: undefined,
      interaction: { id: click.id, type: "press", targetRef: "e9" },
    } as TimelineEntry;
    expect(entryCardOf(bare, recording).target?.text).toBe("[ref=e9]");
    expect(
      entryCardOf(
        {
          ...bare,
          interaction: { id: click.id, type: "press", targetRef: null },
        } as TimelineEntry,
        recording
      ).target
    ).toBeNull();
  });

  it("titles a change no Interaction made by what it is, with no target", () => {
    expect(entryCardOf(change, recording)).toMatchObject({
      icon: "change",
      title: "Element removed",
      target: null,
      changes: [{ chip: { text: "status “Saved”" }, effect: "was removed" }],
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

  it("asks for no highlight when it does not apply", () => {
    const card = entryCardOf(click, ["continue", "discard"]);
    expect(card.target?.highlight).toBeNull();
    expect(card.leave).toBeNull();
  });

  it("offers Discard while paused", () => {
    expect(entryCardOf(click, paused)).toMatchObject({
      discard: { type: "discard", entry: entryId("interaction_1") },
      restore: null,
    });
  });

  it("hides what a discarded entry changed and offers Restore", () => {
    expect(entryCardOf({ ...click, discarded: true }, paused)).toMatchObject({
      discarded: true,
      discard: null,
      restore: { type: "restore", entry: entryId("interaction_1") },
      changes: [],
    });
  });

  it("offers neither Discard nor Restore when they do not apply", () => {
    expect(entryCardOf({ ...click, discarded: true }, recording)).toMatchObject(
      { discard: null, restore: null }
    );
    expect(entryCardOf(click, recording)).toMatchObject({
      discard: null,
      restore: null,
    });
  });

  it("lists no changes for an Interaction that changed nothing", () => {
    expect(entryCardOf({ ...click, changes: null }, recording).changes).toEqual(
      []
    );
  });
});
