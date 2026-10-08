import { expect, it } from "vitest";

import type { Run } from "./run";
import { decodeRuns, encodeRuns, keptRuns, reloadedError } from "./storedRuns";

// Unit tests: which runs the Inspector still shows after a reload.

const succeeded: Run = {
  id: "2@1000",
  toolName: "ListPage_addItem",
  by: "inspector",
  className: "ListPage",
  objectPath: "ListPage",
  arguments: { text: "Milk" },
  status: "succeeded",
  result: '"Added"',
  startedAt: 1_000,
  durationMs: 40,
  interactions: [
    {
      operation: "fill",
      locator: "getByRole('textbox')",
      value: "Milk",
      member: "ListPage.newItem",
    },
  ],
  children: [],
};

const failedOnItem: Run = {
  id: "1@500",
  toolName: "ListItem_remove",
  by: "support-assistant",
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
  interactions: [],
  children: [],
};

const goal: Run = {
  id: "3@2000",
  toolName: "goal",
  by: "ayme-mcp",
  arguments: { goal: "Add milk" },
  status: "succeeded",
  startedAt: 2_000,
  durationMs: 900,
  interactions: [],
  children: [
    {
      id: "4@2100",
      toolName: "fill",
      arguments: { target: "e3", text: "Milk" },
      status: "succeeded",
      startedAt: 2_100,
      durationMs: 30,
      interactions: [
        { operation: "fill", locator: "getByRole('textbox')", value: "Milk" },
      ],
      children: [],
    },
  ],
};

const before = (run: Run): Run => ({ ...run, earlierDocument: true });

function reloaded(runs: readonly Run[]) {
  return decodeRuns(JSON.parse(JSON.stringify(encodeRuns(runs))));
}

it("still shows the runs of every Caller, newest first, with their results and Interactions", () => {
  expect(reloaded([succeeded, failedOnItem])).toEqual([
    before(succeeded),
    before(failedOnItem),
  ]);
});

it("still shows the runs nested under a run, with their Interactions", () => {
  expect(reloaded([goal])).toEqual([before(goal)]);
});

it("shows a nested run that was still running as failed with the reload", () => {
  const [child] = goal.children;
  const running: Run = {
    ...goal,
    status: "running",
    durationMs: undefined,
    children: [{ ...child!, status: "running", durationMs: undefined }],
  };

  expect(reloaded([running])[0]!.children).toEqual([
    {
      ...child!,
      status: "failed",
      error: reloadedError,
      durationMs: undefined,
    },
  ]);
});

it(`keeps only the newest ${keptRuns} runs`, () => {
  const runs = Array.from({ length: keptRuns + 5 }, (_, index) => ({
    ...succeeded,
    id: String(keptRuns + 5 - index),
  }));

  expect(reloaded(runs).map((run) => run.id)).toEqual(
    runs.slice(0, keptRuns).map((run) => run.id)
  );
});

it("shows a run that was still running as failed with the reload, after an unknown time", () => {
  const running: Run = {
    ...succeeded,
    status: "running",
    result: undefined,
    durationMs: undefined,
  };

  const [interrupted] = reloaded([running]);

  expect(interrupted).toEqual(
    before({ ...running, status: "failed", error: reloadedError })
  );
  expect(interrupted).not.toHaveProperty("durationMs");
});

it("shows nothing when nothing is stored yet", () => {
  expect(decodeRuns(undefined)).toEqual([]);
});

it("leaves out a malformed run", () => {
  expect(
    decodeRuns([
      { id: 3, toolName: "click", by: "app" },
      { ...succeeded, status: "done" },
      { ...succeeded, by: "" },
      { ...succeeded, interactions: [{ operation: "click", member: 42 }] },
      { ...goal, children: [{ ...goal.children[0], toolName: 7 }] },
      succeeded,
    ])
  ).toEqual([before(succeeded)]);
});

it("keeps a run's image description but not the image itself", () => {
  const screenshot: Run = {
    ...succeeded,
    result: undefined,
    image: {
      description: "Screenshot of the viewport, 1280×720 PNG",
      src: "data:image/png;base64,iVBORw0KGgo=",
    },
  };
  const { result: _result, ...withoutResult } = screenshot;
  void _result;

  expect(JSON.stringify(encodeRuns([screenshot]))).not.toContain("base64");
  expect(reloaded([screenshot])).toEqual([
    before({
      ...withoutResult,
      image: { description: "Screenshot of the viewport, 1280×720 PNG" },
    }),
  ]);
});

it("keeps an agent's screenshot run and the file its image was saved to", () => {
  const agentRun: Run = {
    id: "3@2000",
    toolName: "screenshot",
    by: "ayme-mcp",
    arguments: {},
    status: "succeeded",
    image: {
      description: "Screenshot of the viewport, 1280×720 PNG",
      src: "data:image/png;base64,iVBORw0KGgo=",
      savedTo: "/tmp/ayme-screenshots/page-1.png",
    },
    startedAt: 2_000,
    durationMs: 90,
    interactions: [],
    children: [],
  };

  expect(reloaded([agentRun])).toEqual([
    before({
      ...agentRun,
      image: {
        description: "Screenshot of the viewport, 1280×720 PNG",
        savedTo: "/tmp/ayme-screenshots/page-1.png",
      },
    }),
  ]);
});

it("keeps no image itself of a run nested under another", () => {
  const screenshot = {
    id: "5@2200",
    toolName: "screenshot",
    arguments: {},
    status: "succeeded" as const,
    image: {
      description: "Screenshot of the viewport, 1280×720 PNG",
      src: "data:image/png;base64,iVBORw0KGgo=",
    },
    startedAt: 2_200,
    durationMs: 60,
    interactions: [],
    children: [],
  };
  const withScreenshot: Run = { ...goal, children: [screenshot] };

  expect(JSON.stringify(encodeRuns([withScreenshot]))).not.toContain("base64");
  expect(reloaded([withScreenshot])).toEqual([
    before({
      ...goal,
      children: [
        {
          ...screenshot,
          image: { description: "Screenshot of the viewport, 1280×720 PNG" },
        },
      ],
    }),
  ]);
});
