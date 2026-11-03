import { expect, it } from "vitest";
import type { Run as LogRun } from "@ayme-dev/ayme";

import { anInteraction, aRun } from "../test-utils/runs";
import { shownRuns } from "./logRuns";

it("keeps a captured target when the Inspector remounts after the element disappeared", () => {
  const interaction = anInteraction({ ref: "e7" });
  const captured = {
    ...interaction,
    target: 'button "Dismiss"',
    context: "ListPage",
  };
  const earlier = aRun({
    id: "1@1000",
    toolName: "click",
    startedAt: 1000,
    interactions: [captured],
  });
  const log: LogRun = {
    id: "1",
    tool: "click",
    by: "inspector",
    status: "succeeded",
    startedAt: 1000,
    interactions: [interaction],
  };
  const [run] = shownRuns({
    log: [log],
    earlier: [earlier],
    notes: new Map([["1@1000", { descriptions: [{}] }]]),
    clearedAt: 0,
  });
  expect(run?.interactions).toEqual([captured]);
});

it("uses current descriptions when nothing was kept, and still shows older notes without descriptions", () => {
  const interaction = anInteraction();
  const log: LogRun = {
    id: "1",
    tool: "click",
    by: "webmcp",
    status: "succeeded",
    startedAt: 1000,
    interactions: [interaction],
  };
  const show = (notes: Parameters<typeof shownRuns>[0]["notes"]) =>
    shownRuns({ log: [log], notes, earlier: [], clearedAt: 0 })[0]
      ?.interactions;
  expect(show(new Map())).toEqual([interaction]);
  expect(
    show(new Map([["1@1000", { target: { className: "Editor" } }]]))
  ).toEqual([interaction]);
  expect(
    show(new Map([["1@1000", { descriptions: [{ target: 'button "Save"' }] }]]))
  ).toEqual([{ ...interaction, target: 'button "Save"' }]);
});

it("keeps nested captured members on remount, while filling in descriptions that were not known before", () => {
  const interaction = anInteraction();
  const parent: LogRun = {
    id: "1",
    tool: "goal",
    by: "webmcp",
    status: "succeeded",
    startedAt: 1000,
    interactions: [],
  };
  const child: LogRun = {
    id: "2",
    parent: "1",
    tool: "Editor.save",
    status: "succeeded",
    startedAt: 1001,
    interactions: [interaction, interaction],
  };
  const earlier = aRun({
    id: "1@1000",
    toolName: "goal",
    children: [
      {
        ...aRun({
          id: "2@1001",
          interactions: [
            { ...interaction, member: "Editor.saveButton" },
            interaction,
          ],
        }),
      },
    ],
  });
  const options: Parameters<typeof shownRuns>[0] = {
    log: [parent, child],
    earlier: [earlier],
    notes: new Map(),
    clearedAt: 0,
  };
  expect(shownRuns(options)[0]?.children[0]?.interactions).toEqual(
    earlier.children[0]?.interactions
  );
  options.notes = new Map([
    [
      "2@1001",
      {
        descriptions: [
          { member: "Changed.button" },
          { target: 'textbox "Body"' },
        ],
      },
    ],
  ]);
  expect(shownRuns(options)[0]?.children[0]?.interactions).toEqual([
    {
      ...interaction,
      member: "Editor.saveButton",
      target: undefined,
      context: undefined,
    },
    { ...interaction, target: 'textbox "Body"' },
  ]);
});
