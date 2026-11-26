import { describe, expect, it } from "vitest";

import { groupsBelow } from "./processGroups.ts";

describe("groupsBelow", () => {
  const table = [
    "  100     1   100", // the agent, in its own group
    "  110   100   100", // a helper in the agent's group
    "  120   100   120", // an MCP server in a group of its own
    "  130   120   130", // its browser, in a third
    "  140   130   130",
    "  200     1   200", // another agent's
    "  210   200   210",
  ].join("\n");

  it("finds the groups of the agent and of every process below it, and no other", () => {
    expect(groupsBelow(100, table).sort()).toEqual([100, 120, 130]);
  });

  it("is the agent's own group when the process table is empty", () => {
    expect(groupsBelow(100, "")).toEqual([100]);
  });
});
