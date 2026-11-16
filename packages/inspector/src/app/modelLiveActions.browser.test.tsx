import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RegisteredPomTool, ToolInfo } from "@ayme-dev/ayme";
import type {
  InspectorPageObject,
  PomManifest,
} from "@ayme-dev/ayme/inspector";

import { startedAyme } from "../tools/test-utils/startedAyme";
import { renderInspector } from "./renderInspector";
import { Inspector } from "../testing";

// Component tests through the whole panel and its runtime wiring: whether a Model
// lens action runs from the panel follows the live tools, not WebMCP
// publication. The runtime is mocked with an editor page whose toolbar has a
// "save" action, and publication is off.

const noArguments = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false,
};

const manifest: PomManifest = {
  className: "Editor",
  members: [
    {
      memberName: "toolbar",
      kind: "component",
      access: "field",
      componentClassName: "Toolbar",
      collection: false,
    },
  ],
  components: [
    {
      className: "Toolbar",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "save",
          toolName: "Toolbar.save",
          description: "Save the document.",
          parameters: [],
        },
      ],
    },
  ],
  tools: [],
};

const save: RegisteredPomTool = {
  rooted: false,
  className: "Toolbar",
  name: "Toolbar.save",
  methodName: "save",
  authorDescription: "Save the document.",
  agentDescription: "Save the document.",
  inputSchema: noArguments,
  parameters: [],
};

/** The editor, with its toolbar on the page or not. */
function editor(toolbarOnPage: boolean): InspectorPageObject {
  return {
    id: "Editor",
    manifest,
    memberObservations: [
      {
        memberName: "toolbar.root",
        kind: "component-root",
        count: toolbarOnPage ? 1 : 0,
      },
    ],
    presentPaths: toolbarOnPage ? ["", "toolbar"] : [""],
    rootMemberPaths: [],
    tools: [save],
  };
}

const saveTool = (available: boolean): ToolInfo[] => [
  {
    name: save.name,
    authorDescription: save.authorDescription,
    agentDescription: save.agentDescription,
    inputSchema: noArguments,
    group: "pageObject",
    available,
  },
];

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

function renderApp({
  toolbarOnPage,
  live,
  registrations,
}: {
  toolbarOnPage: boolean;
  live: ToolInfo[];
  registrations?: InspectorPageObject[];
}) {
  // WebMCP publication is off throughout.
  startedAyme.webMCP.publicationStatus = {
    state: "disabled",
    message: "WebMCP publication is disabled.",
  };
  startedAyme.tools.list.mockReturnValue(live);
  startedAyme.setRegistry({
    pageObjects: registrations ?? [editor(toolbarOnPage)],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }));
  unmounts.push(() => {
    unmount();
    host.remove();
  });
}

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  startedAyme.reset();
  localStorage.clear();
  sessionStorage.clear();
});

it("runs a live action from the panel while WebMCP publication is off", async () => {
  renderApp({ toolbarOnPage: true, live: saveTool(true) });

  await inspector.navigator.model.object("Editor.toolbar").click();

  await expect
    .poll(() => inspector.detail.runCard("save").root.count())
    .toBe(1);
  expect(await inspector.detail.model.offPageAction("save").count()).toBe(0);
});

it("dims an action as not on page when its Page Object isn't on the page", async () => {
  renderApp({ toolbarOnPage: false, live: saveTool(false) });

  await inspector.navigator.model.object("Editor.toolbar").click();
  const action = inspector.detail.model.offPageAction("save");

  await expect.poll(() => action.textContent()).toContain("Not on page");
  expect(await action.getAttribute("aria-disabled")).toBe("true");
  expect(await inspector.detail.runCard("save").root.count()).toBe(0);
});

it.each([true, false])(
  "offers a recursive class action at its concrete path when the middle root is present: %s",
  async (parentPresent) => {
    const child = (memberName: string) => ({
      memberName,
      kind: "component" as const,
      access: "field" as const,
      componentClassName: "Node",
      collection: false,
    });
    const tool = {
      ...save,
      className: "Node",
      name: "Node.open",
      methodName: "open",
    };
    const registration: InspectorPageObject = {
      id: "Tree",
      manifest: {
        className: "Tree",
        tools: [],
        members: [child("node")],
        components: [
          {
            className: "Node",
            members: [child("child")],
            tools: [
              { methodName: "open", toolName: "Node.open", parameters: [] },
            ],
          },
        ],
      },
      memberObservations: [
        { memberName: "node.root", kind: "component-root", count: 1 },
        {
          memberName: "node.child.root",
          kind: "component-root",
          count: parentPresent ? 1 : 0,
        },
        {
          memberName: "node.child.child.root",
          kind: "component-root",
          count: 1,
        },
      ],
      presentPaths: [
        "",
        "node",
        "node.child.child",
        ...(parentPresent ? ["node.child"] : []),
      ],
      rootMemberPaths: [],
      tools: [tool],
    };
    renderApp({
      toolbarOnPage: false,
      live: [
        {
          name: "Node.open",
          inputSchema: noArguments,
          group: "pageObject",
          available: true,
        },
      ],
      registrations: [registration],
    });
    await inspector.navigator.model.pressOnObject("Tree.node", "ArrowRight");
    await inspector.navigator.model.pressOnObject(
      "Tree.node.child",
      "ArrowRight"
    );
    await inspector.navigator.model.object("Tree.node.child.child").click();
    await expect
      .poll(() => inspector.detail.runCard("open").root.count())
      .toBe(1);
    await inspector.navigator.model.pressOnObject(
      "Tree.node.child.child",
      "ArrowRight"
    );
    await inspector.navigator.model
      .object("Tree.node.child.child.child")
      .click();
    await expect
      .poll(() => inspector.detail.runCard("open").root.count())
      .toBe(1);
    expect(await inspector.detail.model.section("Members").count()).toBe(0);
    expect(
      await inspector.navigator.model
        .object("Tree.node.child.child.child.child")
        .count()
    ).toBe(0);
  }
);

it("keeps unobserved model members visible before a child's first observation", async () => {
  renderApp({
    toolbarOnPage: false,
    live: [],
    registrations: [
      {
        ...editor(false),
        memberObservations: [],
      },
    ],
  });
  await inspector.navigator.model.object("Editor.toolbar").click();
  await expect
    .poll(() => inspector.detail.model.member("root").count())
    .toBe(1);
  expect(await inspector.detail.model.memberDescription("root")).toContain(
    "pending"
  );
});

it.each([true, false])(
  "describes a model action as agents read it, on the page or off it: %s",
  async (toolbarOnPage) => {
    const shown = {
      returnPoms: ["ConfirmDialog"],
      agentDescription: "Save the document. Then shows ConfirmDialog.",
    };
    const opener = { ...save, ...shown };
    renderApp({
      toolbarOnPage,
      live: [{ ...saveTool(toolbarOnPage)[0]!, ...shown }],
      registrations: [{ ...editor(toolbarOnPage), tools: [opener] }],
    });
    await inspector.navigator.model.object("Editor.toolbar").click();
    const action = toolbarOnPage
      ? inspector.detail.runCard("save").root
      : inspector.detail.model.offPageAction("save");

    await expect
      .poll(() => action.textContent())
      .toContain("Save the document. Then shows ConfirmDialog.");
  }
);
