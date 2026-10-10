import { expect, it } from "vitest";

import type { RegisteredPomTool } from "@ayme-dev/ayme";
import type { RegisteredPom } from "@ayme-dev/ayme/internal";

import { listRunnableTools } from "./runnableTools";

// Unit tests: the tools the run card runs, from the registry and the tools
// the runtime lists as live. The registration and the live list are
// hand-written.

const addItem: RegisteredPomTool & { componentPath?: string } = {
  pomId: "ListPage",
  methodName: "addItem",
  name: "ListPage.addItem",
  description: "Add an item to the list.",
  inputSchema: { type: "object" },
  parameters: [{ name: "text", optional: false, schema: { type: "string" } }],
};
const rename: RegisteredPomTool & { componentPath?: string } = {
  pomId: "ListPage",
  componentClassName: "ListItem",
  componentPath: "items[]",
  methodName: "rename",
  name: "ListPage.items.rename",
  description: "Rename this item.",
  inputSchema: { type: "object" },
  parameters: [
    { name: "ref", optional: false, schema: { type: "string" } },
    {
      name: "args",
      optional: false,
      schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  ],
};
const listPage: RegisteredPom = {
  id: "ListPage",
  instance: {},
  manifest: { className: "ListPage", members: [], components: [], tools: [] },
  memberObservations: [],
  tools: [addItem, rename],
};
const markElement = {
  name: "mark_element",
  description: "Mark one element on the page.",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
} as const;

it("runs a Page Object action with its parameters", () => {
  const tools = listRunnableTools([listPage], new Map(), [
    { ...addItem, inputSchema: addItem.inputSchema, available: true },
  ]);

  expect(tools.get("ListPage.addItem")).toEqual({
    name: "ListPage.addItem",
    action: "addItem",
    description: "Add an item to the list.",
    argumentsSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    present: true,
    available: true,
  });
});

it("runs a collection action on an item, with the action's own arguments", () => {
  const tools = listRunnableTools(
    [listPage],
    new Map([[rename.name, rename]]),
    []
  );

  expect(tools.get("ListPage.items.rename")).toMatchObject({
    action: "rename",
    collection: "ListPage.items[]",
    argumentsSchema: { properties: { text: { type: "string" } } },
    present: true,
    available: true,
  });
});

it("can't run an action whose Page Object isn't on the page", () => {
  const tools = listRunnableTools([listPage], new Map(), []);

  expect(tools.get("ListPage.addItem")).toMatchObject({
    present: false,
    available: false,
  });
  expect(tools.get("ListPage.addItem")?.reason).toBeUndefined();
});

it("keeps a present action that is unavailable, with the reason the session gives", () => {
  const tools = listRunnableTools([listPage], new Map(), [
    {
      ...addItem,
      inputSchema: addItem.inputSchema,
      available: false,
      reason: "Nothing to add",
    },
  ]);

  expect(tools.get("ListPage.addItem")).toMatchObject({
    present: true,
    available: false,
    reason: "Nothing to add",
  });
});

it("runs every other live tool with its schema, and names its ref argument", () => {
  const tools = listRunnableTools([listPage], new Map(), [
    { ...markElement, available: true },
  ]);

  expect(tools.get("mark_element")).toEqual({
    name: "mark_element",
    action: "mark_element",
    description: "Mark one element on the page.",
    argumentsSchema: markElement.inputSchema,
    present: true,
    available: true,
    refField: "ref",
  });
});

it("names a Browser Tool's key argument, and no other tool's", () => {
  const keyed = (name: string, group: "browser" | "custom") => ({
    name,
    description: "Press a key.",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" as const } },
    },
    group,
    available: true,
  });
  const tools = listRunnableTools([], new Map(), [
    keyed("press_key", "browser"),
    keyed("save_setting", "custom"),
  ]);

  expect(tools.get("press_key")?.keyField).toBe("key");
  expect(tools.get("save_setting")?.keyField).toBeUndefined();
});

it("gives the generate_locator Browser Tool its own form, and no other tool", () => {
  const grouped = (name: string, group: "browser" | "custom") => ({
    name,
    description: "Generate Playwright locators for elements.",
    inputSchema: {
      type: "object" as const,
      properties: { groups: { type: "array" as const } },
    },
    group,
    available: true,
  });
  const tools = listRunnableTools([], new Map(), [
    grouped("generate_locator", "browser"),
    grouped("locate", "custom"),
  ]);

  expect(tools.get("generate_locator")?.locatorGroups).toBe(true);
  expect(tools.get("locate")?.locatorGroups).toBeUndefined();
});

it("never treats a Page Object action's argument as a ref, whatever its name", () => {
  const retarget = {
    ...addItem,
    name: "ListPage.retarget",
    methodName: "retarget",
    parameters: [
      { name: "target", optional: false, schema: { type: "string" as const } },
    ],
  };
  const tools = listRunnableTools(
    [{ ...listPage, tools: [retarget] }],
    new Map([[retarget.name, retarget]]),
    []
  );

  expect(tools.get("ListPage.retarget")?.refField).toBeUndefined();
});
