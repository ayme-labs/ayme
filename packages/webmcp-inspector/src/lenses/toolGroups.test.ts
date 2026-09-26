import { describe, expect, it } from "vitest";

import { listTools, type Publication, type PublishedTool } from "./toolGroups";

// Unit: what the Tools lens lists, from the runtime's published tools and
// publication status. The expected groups come from the runtime's grouping:
// Generated WebMCP Tools, Ref Tools, and get_page_context and pursue_goal.

const active: Publication = { state: "active", message: "Published." };

function tool(name: string, group: PublishedTool["group"]): PublishedTool {
  return { name, description: "", inputSchema: {}, group };
}

// Publication order, as the runtime registers them.
const published = [
  tool("get_page_context", "agent"),
  tool("click_page_state_ref", "ref"),
  tool("fill_page_state_ref", "ref"),
  tool("ListPage.addItem", "pageObject"),
  tool("ListPage.items.rename", "pageObject"),
  tool("pursue_goal", "agent"),
];

const names = (tools: readonly PublishedTool[]) => tools.map((t) => t.name);

describe("listTools", () => {
  it("groups the tools as Page object, Ref and Agent tools, in publication order", () => {
    const listing = listTools(published, active);

    expect(listing.kind).toBe("groups");
    if (listing.kind !== "groups") return;
    expect(
      listing.groups.map(({ label, tools }) => [label, names(tools)])
    ).toEqual([
      ["Page object tools", ["ListPage.addItem", "ListPage.items.rename"]],
      ["Ref tools", ["click_page_state_ref", "fill_page_state_ref"]],
      ["Agent tools", ["get_page_context", "pursue_goal"]],
    ]);
  });

  it("leaves out a group with no published tools", () => {
    const listing = listTools([tool("get_page_context", "agent")], active);

    expect(listing).toEqual({
      kind: "groups",
      groups: [
        {
          group: "agent",
          label: "Agent tools",
          tools: [tool("get_page_context", "agent")],
        },
      ],
    });
  });

  it.each<Publication["state"]>([
    "disabled",
    "waiting",
    "unavailable",
    "disposed",
  ])("lists nothing while publication is %s", (state) => {
    expect(listTools(published, { state, message: "" })).toEqual({
      kind: "empty",
    });
  });

  it("says the list is empty when nothing is published", () => {
    expect(listTools([], active)).toEqual({ kind: "empty" });
  });

  it("lists a failed publication's error instead of tools", () => {
    const message =
      'Cannot publish the Ref Tool "ListPage.addItem": another published tool already uses that name.';

    expect(listTools(published, { state: "failed", message })).toEqual({
      kind: "failed",
      message,
    });
  });
});
