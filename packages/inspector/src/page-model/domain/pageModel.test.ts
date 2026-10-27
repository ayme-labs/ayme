import { describe, expect, it } from "vitest";

import type {
  JsonSchema,
  PomDefinition,
  PomMemberObservation,
  RegisteredPomTool,
} from "@ayme-dev/ayme";
import type { PomManifest, RegisteredPom } from "@ayme-dev/ayme/internal";

import {
  buildPageModel,
  walk,
  type PageObjectNode,
  type Signature,
} from "./pageModel";

// Unit tests: the page model the Model lens shows, built from a hand-written
// registration of a to-do page as the runtime reports it. A page with two
// items, and an archive dialog that isn't open.

/** A stand-in for the definition text's rendering, enough for these actions. */
const actionSignature: Signature = (input) =>
  `(${(isSchema(input)
    ? Object.entries(input.properties ?? {})
    : input.map(({ name, schema }) => [name, schema] as const)
  )
    .map(([name, property]) => `${name}: ${String(property.type)}`)
    .join(", ")})`;

function isSchema(input: Parameters<Signature>[0]): input is JsonSchema {
  return !Array.isArray(input);
}

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
          toolName: "TodoItem.archive",
          description: "Archive this item.",
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
          toolName: "ArchiveDialog.confirm",
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
      parameters: [
        { name: "text", optional: false, schema: { type: "string" } },
      ],
    },
  ],
};

/** A registered tool, with the description the Inspector shows for it. */
function tool(
  name: string,
  methodName: string,
  component?: { className: string; path: string },
  description?: string
): RegisteredPomTool {
  return {
    className: component?.className ?? "TodoPage",
    rooted: false,
    name,
    methodName,
    ...(description === undefined ? {} : { agentDescription: description }),
    inputSchema: noArguments,
    parameters: [],
  };
}

const tools = [
  tool("TodoPage.addItem", "addItem", undefined, "Add an item."),
  tool(
    "TodoItem.archive",
    "archive",
    { className: "TodoItem", path: "items[]" },
    "Archive this item."
  ),
  tool("ArchiveDialog.confirm", "confirm", {
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

/** The paths of the Page Objects the probe found on the page. */
const present = ["", "items[0]", "items[1]"];
/** The members the probe found resolving to their Page Object's root. */
const rootMembers = ["items[0].root", "items[1].root"];

function registration(
  memberObservations: PomMemberObservation[] = probed,
  presentPaths: readonly string[] = memberObservations.length ? present : [],
  rootMemberPaths: readonly string[] = memberObservations.length
    ? rootMembers
    : []
): RegisteredPom {
  return {
    id: "TodoPage",
    instance: {},
    manifest,
    memberObservations,
    presentPaths: new Set(presentPaths),
    rootMemberPaths: new Set(rootMemberPaths),
    tools,
  };
}

// What snapshot describes for this page.
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

const live = new Set(["TodoPage.addItem", "TodoItem.archive"]);

function objectAt(nodes: readonly PageObjectNode[], path: string) {
  const node = [...walk(nodes)].find((candidate) => candidate.path === path);
  if (!node) throw new Error(`No object at ${path}.`);
  return node;
}

describe("the page model", () => {
  it("lists the page's Page Objects as a tree of children, collections and items", () => {
    const { objects } = buildPageModel(
      [registration()],
      live,
      definitions,
      actionSignature
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

  it("shows a Page Object as not live while the probe found it absent, whatever its members", () => {
    const { objects } = buildPageModel(
      [registration(probed, ["items[0]"])],
      live,
      definitions,
      actionSignature
    );

    expect(
      [...walk(objects)]
        .filter(({ kind }) => kind !== "collection")
        .map(({ path, live }) => ({ path, live }))
    ).toEqual([
      { path: "TodoPage", live: false },
      { path: "TodoPage.items[0]", live: true },
      { path: "TodoPage.items[1]", live: false },
      { path: "TodoPage.archiveDialog", live: false },
    ]);
    expect(
      objectAt(objects, "TodoPage").members.map(({ name, live }) => ({
        name,
        live,
      }))
    ).toEqual([
      { name: "newItemInput", live: true },
      { name: "items", live: true },
      { name: "archiveDialog", live: false },
    ]);
  });

  it("shows each member of an object as the page probe found it", () => {
    const { objects } = buildPageModel(
      [registration()],
      live,
      definitions,
      actionSignature
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

  it("hides the member that resolved to the root, whatever its name, on the object and on its model", () => {
    const anchored: PomManifest = {
      ...manifest,
      components: manifest.components.map((component) =>
        component.className === "TodoItem"
          ? {
              ...component,
              members: [
                { memberName: "row", kind: "locator", access: "getter" },
                ...component.members.slice(1),
              ],
            }
          : component
      ),
    };
    const { objects, models } = buildPageModel(
      [
        {
          ...registration(probed, present, ["items[0].row", "items[1].row"]),
          manifest: anchored,
        },
      ],
      live,
      definitions.map((definition) =>
        definition.name === "TodoItem"
          ? { ...definition, children: anchored.components[0]!.members }
          : definition
      ),
      actionSignature
    );

    expect(
      objectAt(objects, "TodoPage.items[0]").members.map(({ name }) => name)
    ).toEqual(["archiveButton"]);
    expect(models[1]?.members.map(({ name }) => name)).toEqual([
      "archiveButton",
    ]);
  });

  it("shows a member named root of a root-less model like any locator member", () => {
    const { objects, models } = buildPageModel(
      [
        registration(
          [
            ...probed.filter(
              ({ memberName }) => memberName !== "archiveDialog.root"
            ),
            { memberName: "archiveDialog.root", kind: "locator", count: 1 },
          ],
          [...present, "archiveDialog"]
        ),
      ],
      live,
      definitions,
      actionSignature
    );

    expect(
      objectAt(objects, "TodoPage.archiveDialog").members.map(
        ({ name, state }) => ({ name, state })
      )
    ).toEqual([
      { name: "root", state: "1 match" },
      { name: "confirmButton", state: "absent" },
    ]);
    expect(models[2]?.members.map(({ name }) => name)).toEqual([
      "root",
      "confirmButton",
    ]);
  });

  it("says a member is pending until the page is first probed", () => {
    const { objects } = buildPageModel(
      [registration([])],
      live,
      [],
      actionSignature
    );

    expect(objectAt(objects, "TodoPage").members[0]).toMatchObject({
      name: "newItemInput",
      state: "pending",
      live: false,
    });
  });

  it("gives each member its path from the page", () => {
    const { objects } = buildPageModel(
      [registration()],
      live,
      definitions,
      actionSignature
    );

    expect(
      objectAt(objects, "TodoPage").members.map(({ name, path }) => ({
        name,
        path,
      }))
    ).toEqual([
      { name: "newItemInput", path: "TodoPage.newItemInput" },
      { name: "items", path: "TodoPage.items" },
      { name: "archiveDialog", path: "TodoPage.archiveDialog" },
    ]);
    expect(objectAt(objects, "TodoPage.items[0]").members[0]?.path).toBe(
      "TodoPage.items[0].archiveButton"
    );
  });

  it("gives each object the actions that run on it, with their tools and whether they are live", () => {
    const { objects } = buildPageModel(
      [registration()],
      live,
      definitions,
      actionSignature
    );

    expect(objectAt(objects, "TodoPage").actions).toEqual([
      {
        name: "addItem",
        description: "Add an item.",
        signature: "(text: string)",
        toolName: "TodoPage.addItem",
        live: true,
      },
    ]);
    expect(
      objectAt(objects, "TodoPage.items[1]").actions.map(
        ({ toolName, live }) => ({ toolName, live })
      )
    ).toEqual([{ toolName: "TodoItem.archive", live: true }]);
    expect(
      objectAt(objects, "TodoPage.archiveDialog").actions.map(
        ({ toolName, live }) => ({ toolName, live })
      )
    ).toEqual([{ toolName: "ArchiveDialog.confirm", live: false }]);
  });

  it("gives a collection inside a collection's items the actions that run on its items", () => {
    // Each to-do item holds a collection of tags with a remove action.
    const tagged: PomManifest = {
      ...manifest,
      components: [
        ...manifest.components.map((component) =>
          component.className === "TodoItem"
            ? {
                ...component,
                members: [
                  ...component.members,
                  {
                    memberName: "tags",
                    kind: "component" as const,
                    access: "field" as const,
                    componentClassName: "Tag",
                    collection: true,
                  },
                ],
              }
            : component
        ),
        {
          className: "Tag",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [
            {
              methodName: "remove",
              toolName: "Tag.remove",
              description: "Remove this tag.",
              parameters: [],
            },
          ],
        },
      ],
    };
    const { objects } = buildPageModel(
      [
        {
          ...registration([
            ...probed,
            {
              memberName: "items[1].tags",
              kind: "component-collection",
              count: 1,
            },
          ]),
          manifest: tagged,
          tools: [
            ...tools,
            tool("Tag.remove", "remove", {
              className: "Tag",
              path: "items[].tags[]",
            }),
          ],
        },
      ],
      live,
      definitions,
      actionSignature
    );

    expect(
      objectAt(objects, "TodoPage.items[1].tags").actions.map(
        ({ toolName }) => toolName
      )
    ).toEqual(["Tag.remove"]);
  });

  it("lists every model snapshot describes, with its instances on the page", () => {
    const { models } = buildPageModel(
      [registration()],
      live,
      definitions,
      actionSignature
    );

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

  it.each([true, false])(
    "describes an action as agents read it, in the object and its model, live: %s",
    (onPage) => {
      // The registration's tool carries its Agent Description; the manifest
      // and the definition carry only what the author wrote.
      const opener = tool(
        "ArchiveDialog.confirm",
        "confirm",
        { className: "ArchiveDialog", path: "archiveDialog" },
        "Shows SettingsPage."
      );
      const registered: RegisteredPom = {
        ...registration(
          probed,
          onPage ? [...present, "archiveDialog"] : present
        ),
        tools: [tools[0]!, tools[1]!, opener],
      };

      const { objects, models } = buildPageModel(
        [registered],
        onPage ? new Set([...live, "ArchiveDialog.confirm"]) : live,
        definitions,
        actionSignature
      );

      const expected = {
        name: "confirm",
        description: "Shows SettingsPage.",
        toolName: "ArchiveDialog.confirm",
        live: onPage,
      };
      expect(objectAt(objects, "TodoPage.archiveDialog").actions).toEqual([
        expect.objectContaining(expected),
      ]);
      expect(models[2]?.actions).toEqual([expect.objectContaining(expected)]);
    }
  );

  it("describes an action with no registered tool by what its author wrote", () => {
    const { objects, models } = buildPageModel(
      [{ ...registration(), tools: [] }],
      live,
      definitions,
      actionSignature
    );

    expect(objectAt(objects, "TodoPage").actions[0]?.description).toBe(
      "Add an item."
    );
    expect(models[0]?.actions[0]?.description).toBe("Add an item.");
  });

  it("gives a model its members and its actions, live or not", () => {
    const { models } = buildPageModel(
      [registration()],
      live,
      definitions,
      actionSignature
    );
    const [page, , dialog] = models;

    expect(page?.members).toEqual([
      {
        name: "newItemInput",
        kind: "locator",
        path: "TodoPage.newItemInput",
      },
      {
        name: "items",
        kind: "component",
        className: "TodoItem",
        collection: true,
        path: "TodoPage.items",
      },
      {
        name: "archiveDialog",
        kind: "component",
        className: "ArchiveDialog",
        collection: false,
        path: "TodoPage.archiveDialog",
      },
    ]);
    expect(dialog?.actions).toEqual([
      {
        name: "confirm",
        signature: "()",
        toolName: "ArchiveDialog.confirm",
        live: false,
      },
    ]);
  });
});
