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
