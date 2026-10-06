import { expect, it } from "vitest";

import type { Run } from "./run";
import { decodeRuns, encodeRuns, keptRuns, reloadedError } from "./storedRuns";

// Unit tests: which runs the Inspector still shows after a reload.

const succeeded: Run = {
  id: 2,
  toolName: "ListPage_addItem",
  className: "ListPage",
  objectPath: "ListPage",
  arguments: { text: "Milk" },
  status: "succeeded",
  result: '"Added"',
  startedAt: 1_000,
  durationMs: 40,
  steps: [
    {
      operation: "fill",
      locator: "getByRole('textbox')",
      value: "Milk",
      member: "ListPage.newItem",
    },
  ],
};

const failedOnItem: Run = {
  id: 1,
  toolName: "ListItem_remove",
  objectPath: "ListPage.items[1]",
  item: {
    path: "ListPage.items[1]",
    name: "[1]",
    pathBelowPage: "items[1]",
    ref: "e4",
    label: "Eggs",
  },
  arguments: {},
  status: "failed",
  error: "TimeoutError: no element",
  startedAt: 500,
  durationMs: 1_000,
  steps: [],
};

function reloaded(runs: readonly Run[]) {
  return decodeRuns(JSON.parse(JSON.stringify(encodeRuns(runs))));
}

it("still shows the runs, newest first, with their results and steps", () => {
  expect(reloaded([succeeded, failedOnItem])).toEqual([
    succeeded,
    failedOnItem,
  ]);
});

it(`keeps only the newest ${keptRuns} runs`, () => {
  const runs = Array.from({ length: keptRuns + 5 }, (_, index) => ({
    ...succeeded,
    id: keptRuns + 5 - index,
  }));

  expect(reloaded(runs).map((run) => run.id)).toEqual(
    runs.slice(0, keptRuns).map((run) => run.id)
  );
});

it("shows a run that was still running as failed with the reload", () => {
  const running: Run = { ...succeeded, status: "running", result: undefined };

  expect(reloaded([running])).toEqual([
    { ...running, status: "failed", error: reloadedError },
  ]);
});

it("shows nothing when nothing is stored yet", () => {
  expect(decodeRuns(undefined)).toEqual([]);
});

it("leaves out a malformed run", () => {
  expect(
    decodeRuns([
      { id: "3", toolName: "click" },
      { ...succeeded, status: "done" },
      succeeded,
    ])
  ).toEqual([succeeded]);
});
