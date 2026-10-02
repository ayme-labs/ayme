import { describe, expect, it } from "vitest";

import { attachToolModels, listTools, type LiveTool } from "./toolGroups";

// Unit: what the Tools lens lists, from the runtime's live tools. The expected groups come from the runtime's grouping:
// Generated WebMCP Tools, Ref Tools, and get_page_context and pursue_goal.

function tool(name: string, group: LiveTool["group"]): LiveTool {
  return { name, description: "", inputSchema: {}, group };
}

// The runtime's order.
const live = [
  tool("get_page_context", "agent"),
  tool("click_page_state_ref", "ref"),
  tool("fill_page_state_ref", "ref"),
  tool("ListPage.addItem", "pageObject"),
  tool("ListPage.items.rename", "pageObject"),
  tool("pursue_goal", "agent"),
];

const names = (tools: readonly LiveTool[]) => tools.map((t) => t.name);

describe("listTools", () => {
  it("groups the tools as Page object, Ref and Agent tools, in the runtime's order", () => {
    expect(
      listTools(live).map(({ label, tools }) => [label, names(tools)])
    ).toEqual([
      ["Page object tools", ["ListPage.addItem", "ListPage.items.rename"]],
      ["Ref tools", ["click_page_state_ref", "fill_page_state_ref"]],
      ["Agent tools", ["get_page_context", "pursue_goal"]],
    ]);
  });

  it("leaves out a group with no tools", () => {
    expect(listTools([tool("get_page_context", "agent")])).toEqual([
      {
        group: "agent",
        label: "Agent tools",
        tools: [tool("get_page_context", "agent")],
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
      ["get_page_context", undefined],
      ["click_page_state_ref", undefined],
      ["fill_page_state_ref", undefined],
      ["ListPage.addItem", "ListPage"],
      ["ListPage.items.rename", "ListItem"],
      ["pursue_goal", undefined],
    ]);
  });
});
