import { describe, expect, it } from "vitest";

import type {
  PomDefinition,
  PomManifest,
  PomMemberObservation,
  RegisteredPomTool,
} from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";

import { buildPageModel, walk, type PageObjectNode } from "./pageModel";

// Unit tests: the page model the Model lens shows, built from a hand-written
// registration of a to-do page as the runtime reports it. A page with two
// items, and an archive dialog that isn't open.

const noArguments = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false,
};
const textArgument = {
  type: "object" as const,
  properties: { text: { type: "string" as const } },
  required: ["text"],
  additionalProperties: false,
};

const manifest: PomManifest = {
  className: "TodoPage",
  members: [
    { memberName: "newItemInput", kind: "locator", access: "field" },
    {
      memberName: "items",
      kind: "component",
      access: "getter",
      componentClassName: "TodoItem",
      collection: true,
    },
    {
      memberName: "archiveDialog",
      kind: "component",
      access: "field",
      componentClassName: "ArchiveDialog",
      collection: false,
    },
  ],
  components: [
    {
      className: "TodoItem",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "archiveButton", kind: "locator", access: "field" },
      ],
      tools: [
        {
          methodName: "archive",
          toolName: "archive",
          description: "Archive this item.",
          authoredDescription: "Archive this item.",
          inputSchema: noArguments,
          parameters: [],
        },
      ],
    },
    {
      className: "ArchiveDialog",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "confirmButton", kind: "locator", access: "field" },
      ],
      tools: [
        {
          methodName: "confirm",
          toolName: "confirm",
          description: "Confirm the archive.",
          inputSchema: noArguments,
          parameters: [],
        },
      ],
    },
  ],
  tools: [
    {
      methodName: "addItem",
      toolName: "TodoPage.addItem",
      description: "Add an item.",
      authoredDescription: "Add an item.",
      inputSchema: textArgument,
      parameters: [
        { name: "text", optional: false, schema: { type: "string" } },
      ],
    },
  ],
};

function tool(
  name: string,
  methodName: string,
  component?: { className: string; path: string }
): RegisteredPomTool & { componentPath?: string } {
  return {
    pomId: "TodoPage",
    name,
    methodName,
    description: "",
    inputSchema: noArguments,
    parameters: [],
    execute: async () => null,
    ...(component
      ? {
          componentClassName: component.className,
          componentPath: component.path,
        }
      : {}),
  };
}

const tools = [
  tool("TodoPage.addItem", "addItem"),
  tool("TodoPage.items.archive", "archive", {
    className: "TodoItem",
    path: "items[]",
  }),
  tool("TodoPage.archiveDialog.confirm", "confirm", {
    className: "ArchiveDialog",
    path: "archiveDialog",
  }),
];

const probed: PomMemberObservation[] = [
  { memberName: "newItemInput", kind: "locator", count: 1 },
  { memberName: "items", kind: "component-collection", count: 2 },
  { memberName: "items[0].root", kind: "component-root", count: 1 },
  { memberName: "items[0].archiveButton", kind: "locator", count: 1 },
  { memberName: "items[1].root", kind: "component-root", count: 1 },
  { memberName: "items[1].archiveButton", kind: "locator", count: 0 },
  { memberName: "archiveDialog.root", kind: "component-root", count: 0 },
  { memberName: "archiveDialog.confirmButton", kind: "locator", count: 0 },
];

function registration(
  memberObservations: PomMemberObservation[] = probed
): RegisteredPom {
  return { id: "TodoPage", instance: {}, manifest, memberObservations, tools };
}

// What get_page_context describes for this page.
const definitions: PomDefinition[] = [
  {
    name: "TodoPage",
    children: manifest.members,
    actions: [
      {
        name: "addItem",
        description: "Add an item.",
        inputSchema: textArgument,
        returnPoms: [],
      },
    ],
  },
  {
    name: "TodoItem",
    children: manifest.components[0]!.members,
    actions: [
      {
        name: "archive",
        description: "Archive this item.",
        inputSchema: noArguments,
        returnPoms: [],
      },
    ],
  },
  {
    name: "ArchiveDialog",
    children: manifest.components[1]!.members,
    actions: [{ name: "confirm", inputSchema: noArguments, returnPoms: [] }],
  },
];

const published = new Set(["TodoPage.addItem", "TodoPage.items.archive"]);

function objectAt(nodes: readonly PageObjectNode[], path: string) {
  const node = [...walk(nodes)].find((candidate) => candidate.path === path);
  if (!node) throw new Error(`No object at ${path}.`);
  return node;
}

describe("the page model", () => {
  it("lists the page's Page Objects as a tree of children, collections and items", () => {
    const { objects } = buildPageModel(
      [registration()],
      published,
      definitions
    );

    expect(
      [...walk(objects)].map(({ path, kind, className, live }) => ({
        path,
        kind,
        className,
        live,
      }))
    ).toEqual([
      { path: "TodoPage", kind: "page", className: "TodoPage", live: true },
      {
        path: "TodoPage.items",
        kind: "collection",
        className: "TodoItem",
        live: true,
      },
      {
        path: "TodoPage.items[0]",
        kind: "item",
        className: "TodoItem",
        live: true,
      },
      {
        path: "TodoPage.items[1]",
        kind: "item",
        className: "TodoItem",
        live: true,
      },
      {
        path: "TodoPage.archiveDialog",
        kind: "component",
        className: "ArchiveDialog",
        live: false,
      },
    ]);
  });

  it("shows each member of an object as the page probe found it", () => {
    const { objects } = buildPageModel(
      [registration()],
      published,
      definitions
    );

    expect(
      objectAt(objects, "TodoPage").members.map(({ name, state, live }) => ({
        name,
        state,
        live,
      }))
    ).toEqual([
      { name: "newItemInput", state: "1 match", live: true },
      { name: "items", state: "2 items", live: true },
      { name: "archiveDialog", state: "not on page", live: false },
    ]);
    expect(
      objectAt(objects, "TodoPage.items[1]").members.map(({ name, state }) => ({
        name,
        state,
      }))
    ).toEqual([{ name: "archiveButton", state: "absent" }]);
  });

  it("says a member is pending until the page is first probed", () => {
    const { objects } = buildPageModel([registration([])], published, []);

    expect(objectAt(objects, "TodoPage").members[0]).toMatchObject({
      name: "newItemInput",
      state: "pending",
      live: false,
    });
  });

  it("highlights an object and its members by their registry paths", () => {
    const { objects } = buildPageModel(
      [registration()],
      published,
      definitions
    );
    const item = objectAt(objects, "TodoPage.items[0]");

    expect(item.highlightPath).toBe("TodoPage.items[0].root");
    expect(item.members[0]?.highlightPath).toBe(
      "TodoPage.items[0].archiveButton"
    );
    expect(objectAt(objects, "TodoPage.items").highlightPath).toBe(
      "TodoPage.items"
    );
  });

  it("gives each object the actions that run on it, with their tools and publication", () => {
    const { objects } = buildPageModel(
      [registration()],
      published,
      definitions
    );

    expect(objectAt(objects, "TodoPage").actions).toEqual([
      {
        name: "addItem",
        description: "Add an item.",
        signature: "(text: string)",
        toolName: "TodoPage.addItem",
        published: true,
      },
    ]);
    expect(
      objectAt(objects, "TodoPage.items[1]").actions.map(
        ({ toolName, published }) => ({ toolName, published })
      )
    ).toEqual([{ toolName: "TodoPage.items.archive", published: true }]);
    expect(
      objectAt(objects, "TodoPage.archiveDialog").actions.map(
        ({ toolName, published }) => ({ toolName, published })
      )
    ).toEqual([
      { toolName: "TodoPage.archiveDialog.confirm", published: false },
    ]);
  });

  it("lists every model get_page_context describes, with its instances on the page", () => {
    const { models } = buildPageModel([registration()], published, definitions);

    expect(
      models.map(({ className, instancePaths }) => ({
        className,
        instancePaths,
      }))
    ).toEqual([
      { className: "TodoPage", instancePaths: ["TodoPage"] },
      {
        className: "TodoItem",
        instancePaths: ["TodoPage.items[0]", "TodoPage.items[1]"],
      },
      { className: "ArchiveDialog", instancePaths: [] },
    ]);
  });

  it("gives a model its members and its actions, published or not", () => {
    const { models } = buildPageModel([registration()], published, definitions);
    const [page, , dialog] = models;

    expect(page?.members).toEqual([
      {
        name: "newItemInput",
        kind: "locator",
        highlightPath: "TodoPage.newItemInput",
      },
      {
        name: "items",
        kind: "component",
        className: "TodoItem",
        collection: true,
      },
      {
        name: "archiveDialog",
        kind: "component",
        className: "ArchiveDialog",
        collection: false,
      },
    ]);
    expect(dialog?.actions).toEqual([
      {
        name: "confirm",
        signature: "()",
        toolNames: ["TodoPage.archiveDialog.confirm"],
        publishedToolNames: [],
      },
    ]);
  });
});
