import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PomManifest, RegisteredPomTool } from "@ayme-dev/ayme";
import type { PublishedToolInfo, RegisteredPom } from "@ayme-dev/ayme/internal";

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
          toolName: "save",
          description: "Save the document.",
          inputSchema: noArguments,
          parameters: [],
        },
      ],
    },
  ],
  tools: [],
};

const save: RegisteredPomTool & { componentPath: string } = {
  pomId: "Editor",
  name: "Editor.toolbar.save",
  methodName: "save",
  componentClassName: "Toolbar",
  componentPath: "toolbar",
  description: "Save the document.",
  inputSchema: noArguments,
  parameters: [],
  execute: async () => null,
};

/** The editor, with its toolbar on the page or not. */
function editor(toolbarOnPage: boolean): RegisteredPom {
  return {
    id: "Editor",
    instance: {},
    manifest,
    memberObservations: [
      {
        memberName: "toolbar.root",
        kind: "component-root",
        count: toolbarOnPage ? 1 : 0,
      },
    ],
    tools: [save],
  };
}

const saveLive: PublishedToolInfo[] = [
  {
    name: save.name,
    description: save.description,
    inputSchema: noArguments,
    group: "pageObject",
  },
];

const runtime = vi.hoisted(() => ({
  registrations: [] as unknown[],
  liveTools: [] as unknown[],
  // WebMCP publication is off throughout.
  publication: {
    state: "disabled" as const,
    message: "WebMCP publication is disabled.",
  },
}));

vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { asStartedAyme, startedAyme } =
    await import("../tools/test-utils/startedAyme");
  startedAyme.tools.list.mockImplementation(
    () => runtime.liveTools as PublishedToolInfo[]
  );
  startedAyme.webMCP.publicationStatus = runtime.publication;
  const { pageStateNodeEntry } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  return {
    pageStateNodeEntry,
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    peekPageStateForDocument: vi.fn(async () => ({
      projected: { roots: [] },
      elementsByRef: new Map(),
    })),
    listElementToolTargets: vi.fn(async () => new Map()),
    getPomDefinitionText: vi.fn(() => ""),
    listRegisteredPomTargets: vi.fn(async () => []),
    listRegisteredPomTools: vi.fn(() => []),
    listRegisteredPoms: vi.fn(() => runtime.registrations),
    getStartedAyme: asStartedAyme,
    subscribeToStartedAyme: () => () => {},
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

function renderApp({
  toolbarOnPage,
  live,
}: {
  toolbarOnPage: boolean;
  live: PublishedToolInfo[];
}) {
  runtime.registrations = [editor(toolbarOnPage)];
  runtime.liveTools = live;
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
  localStorage.clear();
  sessionStorage.clear();
});

it("runs a live action from the panel while WebMCP publication is off", async () => {
  renderApp({ toolbarOnPage: true, live: saveLive });

  await inspector.navigator.model.object("Editor.toolbar").click();

  await expect
    .poll(() => inspector.detail.runCard("save").root.count())
    .toBe(1);
  expect(await inspector.detail.model.offPageAction("save").count()).toBe(0);
});

it("dims an action as not on page when its Page Object isn't on the page", async () => {
  renderApp({ toolbarOnPage: false, live: [] });

  await inspector.navigator.model.object("Editor.toolbar").click();
  const action = inspector.detail.model.offPageAction("save");

  await expect.poll(() => action.textContent()).toContain("Not on page");
  expect(await action.getAttribute("aria-disabled")).toBe("true");
  expect(await inspector.detail.runCard("save").root.count()).toBe(0);
});
