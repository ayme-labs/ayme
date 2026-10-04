import { describe, expect, it } from "vitest";

import {
  addTarget,
  groupOutcomes,
  setContainer,
  toggleTarget,
  type LocatorGroup,
} from "./locatorGroups";

describe("editing groups", () => {
  const groups: LocatorGroup[] = [
    { targets: ["e2"] },
    { targets: [], within: "e5" },
  ];

  it("toggles a target in one group only", () => {
    expect(toggleTarget(groups, 1, "e6")).toEqual([
      { targets: ["e2"] },
      { targets: ["e6"], within: "e5" },
    ]);
    expect(toggleTarget(groups, 0, "e2")).toEqual([
      { targets: [] },
      { targets: [], within: "e5" },
    ]);
  });

  it("adds a target once", () => {
    expect(addTarget(groups, 0, "e2")).toEqual(groups);
    expect(addTarget(groups, 0, "e3")[0]).toEqual({ targets: ["e2", "e3"] });
  });

  it("sets and clears a container", () => {
    expect(setContainer(groups, 0, "e4")[0]).toEqual({
      targets: ["e2"],
      within: "e4",
    });
    expect(setContainer(groups, 1, undefined)[1]).toEqual({ targets: [] });
  });
});

describe("a run's outcomes", () => {
  const ran: LocatorGroup[] = [
    { targets: ["e2", "e9"] },
    { targets: ["e6"], within: "e5" },
    { targets: ["e7"], within: "e8" },
  ];
  const run = {
    arguments: { groups: ran },
    result: JSON.stringify({
      groups: [
        {
          locators: [
            { target: "e2", locator: "getByRole('heading')" },
            { target: "e9", error: 'Cannot generate a locator for "e9".' },
          ],
        },
        {
          within: "e5",
          locators: [{ target: "e6", locator: "getByRole('button')" }],
        },
        { within: "e8", error: 'Cannot scope locators to ref "e8".' },
      ],
    }),
  };

  it("gives each group its locators and errors, by index", () => {
    const [page, row, stale] = groupOutcomes(ran, run);

    expect(page).toEqual({
      targets: new Map([
        ["e2", { locator: "getByRole('heading')" }],
        ["e9", { error: 'Cannot generate a locator for "e9".' }],
      ]),
    });
    expect(row).toEqual({
      targets: new Map([["e6", { locator: "getByRole('button')" }]]),
    });
    expect(stale).toEqual({ error: 'Cannot scope locators to ref "e8".' });
  });

  it("gives a group nothing once its container differs from the run's", () => {
    expect(
      groupOutcomes([ran[0]!, { targets: ["e6"], within: "e4" }], run)[1]
    ).toBeUndefined();
  });

  it("gives nothing for a run without a result of this shape", () => {
    expect(groupOutcomes(ran, undefined)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(groupOutcomes(ran, { arguments: {}, result: "not json" })).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
