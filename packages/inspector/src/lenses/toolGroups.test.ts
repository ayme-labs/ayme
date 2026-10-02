import { describe, expect, it } from "vitest";

import { attachToolModels, listTools, type LiveTool } from "./toolGroups";

// Unit: what the Tools lens lists, from the runtime's live tools. The expected groups come from the runtime's grouping:
// Page Object Tools, Ref Tools, and snapshot and goal.

function tool(name: string, group: LiveTool["group"]): LiveTool {
  return { name, description: "", inputSchema: {}, group };
}

// The runtime's order.
const live = [
  tool("snapshot", "agent"),
  tool("click", "ref"),
  tool("fill", "ref"),
  tool("ListPage.addItem", "pageObject"),
  tool("ListPage.items.rename", "pageObject"),
  tool("goal", "agent"),
];

const names = (tools: readonly LiveTool[]) => tools.map((t) => t.name);

describe("listTools", () => {
  it("groups the tools as Page object, Ref and Agent tools, in the runtime's order", () => {
    expect(
      listTools(live).map(({ label, tools }) => [label, names(tools)])
    ).toEqual([
      ["Page object tools", ["ListPage.addItem", "ListPage.items.rename"]],
      ["Ref tools", ["click", "fill"]],
      ["Agent tools", ["snapshot", "goal"]],
    ]);
  });

  it("leaves out a group with no tools", () => {
    expect(listTools([tool("snapshot", "agent")])).toEqual([
      {
        group: "agent",
        label: "Agent tools",
        tools: [tool("snapshot", "agent")],
      },
    ]);
  });

  it("lists nothing when no tool is live", () => {
    expect(listTools([])).toEqual([]);
  });
});

describe("attachToolModels", () => {
  it("gives each Page object tool the model whose action it is", () => {
    const models = [
      { className: "ListPage", tools: [{ name: "ListPage.addItem" }] },
      { className: "ListItem", tools: [{ name: "ListPage.items.rename" }] },
    ];

    expect(
      attachToolModels(live, models).map(({ name, pomClassName }) => [
        name,
        pomClassName,
      ])
    ).toEqual([
      ["snapshot", undefined],
      ["click", undefined],
      ["fill", undefined],
      ["ListPage.addItem", "ListPage"],
      ["ListPage.items.rename", "ListItem"],
      ["goal", undefined],
    ]);
  });
});
