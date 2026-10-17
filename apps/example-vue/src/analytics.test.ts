import type { AymeRuns, Run } from "@ayme-dev/ayme";
import { afterEach, describe, expect, it } from "vitest";

import { trackToolRuns } from "./analytics";

afterEach(() => {
  delete window.dataLayer;
});

function fakeRuns() {
  let listener: (runs: readonly Run[]) => void = () => {};
  const runs: AymeRuns = {
    list: () => [],
    subscribe(next) {
      listener = next;
      return () => {};
    },
  };
  return { runs, publish: (list: Run[]) => listener(list) };
}

const run = (fields: Partial<Run> & Pick<Run, "id" | "status">) =>
  ({
    tool: "ListPage.items.rename",
    startedAt: 0,
    interactions: [],
    by: "inspector",
    ...fields,
  }) as Run;

describe("Tool run analytics", () => {
  it("reports each top-level Run once, when it ends", () => {
    window.dataLayer = [];
    const { runs, publish } = fakeRuns();
    trackToolRuns(runs);

    publish([run({ id: "1", status: "running" })]);
    publish([
      run({ id: "1", status: "succeeded" }),
      { ...run({ id: "2", status: "succeeded" }), by: undefined, parent: "1" },
    ]);
    publish([
      run({ id: "1", status: "succeeded" }),
      run({ id: "3", status: "failed", by: "webmcp", tool: "ListPage.add" }),
    ]);

    expect(window.dataLayer).toEqual([
      {
        event: "playground_tool_run",
        tool: "ListPage.items.rename",
        caller: "inspector",
        status: "succeeded",
      },
      {
        event: "playground_tool_run",
        tool: "ListPage.add",
        caller: "webmcp",
        status: "failed",
      },
    ]);
  });
});
