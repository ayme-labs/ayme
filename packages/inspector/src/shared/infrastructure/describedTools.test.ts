import { expect, it } from "vitest";

import type { ToolInfo } from "@ayme-dev/ayme";
import type { RegisteredPom } from "@ayme-dev/ayme/internal";

import { describeLiveTools, describeRegisteredPoms } from "./describedTools";

// Unit tests: the tools as the Inspector shows them, described as Ayme MCP
// gives them to agents, over the real description rules.

const addItem: ToolInfo = {
  name: "ListPage.addItem",
  description: "Add an item to the list.",
  inputSchema: { type: "object" },
  group: "pageObject",
  available: true,
};
const clear: ToolInfo = {
  name: "ListPage.clear",
  inputSchema: { type: "object" },
  group: "pageObject",
  available: true,
};
const openSettings: ToolInfo = {
  ...clear,
  name: "ListPage.openSettings",
  returnPoms: ["SettingsPage"],
};

const registeredTool = (
  tool: Partial<RegisteredPom["tools"][number]> & { name: string }
): RegisteredPom["tools"][number] => ({
  className: "ListPage",
  rooted: false,
  methodName: tool.name.slice(tool.name.indexOf(".") + 1),
  inputSchema: { type: "object" },
  parameters: [],
  ...tool,
});
const registration = (
  tools: RegisteredPom["tools"][number][]
): RegisteredPom => ({
  id: "ListPage",
  instance: {},
  manifest: { className: "ListPage", members: [], components: [], tools: [] },
  memberObservations: [],
  presentPaths: new Set(),
  rootMemberPaths: new Set(),
  tools,
});

it("describes each live tool as Ayme MCP gives it to agents", () => {
  const [listed, bare, opener] = describeLiveTools([
    addItem,
    clear,
    openSettings,
  ]);

  expect(listed).toBe(addItem);
  expect(bare).toBe(clear);
  expect(opener).toStrictEqual({
    ...openSettings,
    description: "Then shows SettingsPage.",
  });
});

it("describes a registered Page Object's tools, on the page or off it", () => {
  const opener = registeredTool({
    name: "ListPage.openSettings",
    description: "Open the settings.",
    returnPoms: ["SettingsPage"],
  });
  const original = registration([opener]);

  const [described] = describeRegisteredPoms([original]);

  expect(described?.tools).toStrictEqual([
    { ...opener, description: "Open the settings. Then shows SettingsPage." },
  ]);
  expect(described).toStrictEqual({ ...original, tools: described?.tools });
});

it("keeps a registration whose tools say nothing more", () => {
  const bare = registeredTool({ name: "ListPage.clear" });
  const own = registeredTool({
    name: "ListPage.addItem",
    description: "Add an item to the list.",
  });
  const original = registration([bare, own]);

  const [described] = describeRegisteredPoms([original]);

  expect(described).toBe(original);
  expect(described?.tools[0]).not.toHaveProperty("description");
});

it("describes a registration with one tool to describe among others", () => {
  const bare = registeredTool({ name: "ListPage.clear" });
  const opener = registeredTool({
    name: "ListPage.openSettings",
    returnPoms: ["SettingsPage"],
  });

  const [described] = describeRegisteredPoms([registration([bare, opener])]);

  expect(described?.tools[0]).toBe(bare);
  expect(described?.tools[1]?.description).toBe("Then shows SettingsPage.");
});
