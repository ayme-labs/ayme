import { describe, expect, it } from "vitest";

import type { PageTool } from "../../contract";
import { AgentToolView } from "./agentToolView";

const tool = (name: string, reading: Partial<PageTool> = {}): PageTool => ({
  name,
  description: `${name}.`,
  inputSchema: { properties: {} },
  available: true,
  ...reading,
});

const changed = (...lines: string[]) =>
  [
    "The connected tools changed since your previous call.",
    ...lines,
    "ayme_list_tools lists the current tools; ayme_call runs any of them.",
  ].join(" ");

const view = (tools: readonly PageTool[] = []) =>
  new AgentToolView(["ayme_call"], tools);

describe("the MCP list", () => {
  it("changes when a tool appears, goes or changes its parameters or description, and not when only its availability changes", () => {
    const agent = view([tool("Panel.remove")]);

    expect(agent.toolsChanged([tool("Panel.remove")])).toBe(false);
    expect(
      agent.toolsChanged([tool("Panel.remove", { available: false })])
    ).toBe(false);
    expect(agent.toolsChanged([tool("Panel.remove"), tool("Panel.copy")])).toBe(
      true
    );
    expect(
      agent.toolsChanged([
        tool("Panel.remove", { description: "Removes the item." }),
        tool("Panel.copy"),
      ])
    ).toBe(true);
    expect(
      agent.toolsChanged([
        tool("Panel.remove", { description: "Removes the item." }),
        tool("Panel.copy", {
          inputSchema: { properties: { text: { type: "string" } } },
        }),
      ])
    ).toBe(true);
    expect(agent.toolsChanged([])).toBe(true);
    expect(agent.toolsChanged([])).toBe(false);
  });

  it("leaves out a page tool that shares a server tool's name, and does not change with it", () => {
    const agent = view();

    expect(agent.toolsChanged([tool("ayme_call")])).toBe(false);
    expect(agent.listRead([tool("ayme_call"), tool("Panel.remove")])).toEqual([
      tool("Panel.remove"),
    ]);
  });
});

describe("the tool change note", () => {
  it("names every tool to an agent that has seen none, even those there as the server started", () => {
    const agent = view([tool("Panel.remove")]);

    expect(
      agent.resultReturned({
        tools: [
          tool("Panel.remove"),
          tool("Panel.copy", { available: false, reason: "Nothing selected" }),
        ],
        hidden: [],
      })
    ).toBe(
      changed(
        "Appeared: Panel.remove, Panel.copy (unavailable: Nothing selected)."
      )
    );
  });

  it("notes only what changed since the previous result", () => {
    const agent = view();
    agent.resultReturned({ tools: [tool("Panel.remove")], hidden: [] });

    expect(
      agent.resultReturned({ tools: [tool("Panel.remove")], hidden: [] })
    ).toBeUndefined();
    expect(
      agent.resultReturned({
        tools: [tool("Panel.remove", { available: false })],
        hidden: ["Peek.jobs"],
      })
    ).toBe(
      changed(
        "Became unavailable: Panel.remove.",
        "Hidden: Peek.jobs, because another App Process offers a tool with the same name; you reach the first App Process's."
      )
    );
  });

  it("counts the listed tools as seen, each new one as available", () => {
    const agent = view();
    agent.listRead([
      tool("Panel.remove"),
      tool("Panel.copy", { available: false }),
    ]);

    expect(
      agent.resultReturned({
        tools: [tool("Panel.remove"), tool("Panel.copy", { available: false })],
        hidden: [],
      })
    ).toBe(changed("Became unavailable: Panel.copy."));
  });

  it("keeps the availability and hidden tools the agent last heard of when it reads the list", () => {
    const agent = view();
    agent.resultReturned({
      tools: [tool("Panel.remove", { available: false })],
      hidden: ["Peek.jobs"],
    });
    agent.listRead([tool("Panel.remove")]);

    expect(
      agent.resultReturned({
        tools: [tool("Panel.remove")],
        hidden: ["Peek.jobs"],
      })
    ).toBe(changed("Became available: Panel.remove."));
  });

  it("keeps each listed tool's own availability", () => {
    const agent = view();
    agent.resultReturned({
      tools: [tool("Panel.remove", { available: false }), tool("Panel.copy")],
      hidden: [],
    });
    agent.listRead([tool("Panel.remove"), tool("Panel.copy")]);

    expect(
      agent.resultReturned({
        tools: [tool("Panel.remove", { available: false }), tool("Panel.copy")],
        hidden: [],
      })
    ).toBeUndefined();
  });

  it("names a tool whose parameters or description changed since the agent read the list", () => {
    const agent = view();
    agent.listRead([tool("Search.run"), tool("Panel.remove")]);

    expect(
      agent.resultReturned({
        tools: [
          tool("Search.run", {
            inputSchema: { properties: { text: { type: "string" } } },
          }),
          tool("Panel.remove", { description: "Removes the item." }),
        ],
        hidden: [],
      })
    ).toBe(
      changed("Changed: Search.run (parameters), Panel.remove (description).")
    );
  });

  it("leaves out a page tool that shares a server tool's name", () => {
    const agent = view();

    expect(
      agent.resultReturned({ tools: [tool("ayme_call")], hidden: [] })
    ).toBeUndefined();
  });
});

it("tells a tool the connection offered and that went from one it never offered", () => {
  const agent = view([tool("Panel.remove")]);
  agent.toolsChanged([tool("Panel.copy")]);
  agent.toolsChanged([]);

  expect(agent.wasOffered("Panel.remove")).toBe(true);
  expect(agent.wasOffered("Panel.copy")).toBe(true);
  expect(agent.wasOffered("Panel.paste")).toBe(false);
});
