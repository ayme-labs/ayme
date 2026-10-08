import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RegisteredPomTool } from "@ayme-dev/ayme";
import {
  getPageStateForElements,
  listRegisteredPomTargets,
  listAvailablePomTools,
  listRegisteredPoms,
  subscribeToAgentImageRuns,
  type AgentImageRun,
  type RegisteredPom,
} from "@ayme-dev/ayme/internal";

import { renderInspector } from "./renderInspector";
import { startedAyme } from "../tools/test-utils/startedAyme";
import { Inspector } from "../testing";

// Component tests: Runs reading the page's Run log, with fixture Runs by
// several Callers, driven through the Inspector POM on playwright-lite. The
// runtime is replaced by a stand-in session whose Run log the test fills,
// and which records the panel's own runs there for the Caller they name.
vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { appProcessToolsOf, asStartedAyme } =
    await import("../tools/test-utils/startedAyme");
  const { pageStateNodeEntry, toolInputViolations } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  const { forest, node } = await import("../structure/test-utils/projected");
  return {
    pageStateNodeEntry,
    toolInputViolations,
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    lookAtPageStateForDocument: vi.fn(async () => ({
      projected: forest(
        node(
          { ref: "e1", role: "main" },
          node({ ref: "e2", role: "button", name: "Save" })
        )
      ),
      elementsByRef: new Map(),
    })),
    listElementToolTargets: vi.fn(async () => new Map()),
    getPomDefinitionText: vi.fn(() => ""),
    getPageStateForElements: vi.fn(async () => ({ refs: [] })),
    listRegisteredPomTargets: vi.fn(async () => []),
    listAvailablePomTools: vi.fn(() => []),
    getStartedAyme: asStartedAyme,
    getAppProcessTools: appProcessToolsOf,
    subscribeToStartedAyme: () => () => {},
    subscribeToAgentImageRuns: vi.fn(() => () => {}),
    listRegisteredPoms: vi.fn(() => []),
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

const save: RegisteredPomTool = {
  pomId: "Editor",
  methodName: "save",
  name: "Editor.save",
  description: "Save the editor.",
  inputSchema: { type: "object" },
  parameters: [],
};
const editor: RegisteredPom = {
  id: "Editor",
  instance: {},
  manifest: {
    className: "Editor",
    members: [{ memberName: "saveButton", kind: "locator", access: "field" }],
    components: [],
    tools: [
      {
        methodName: save.methodName,
        toolName: save.name,
        description: save.description,
        inputSchema: save.inputSchema,
        parameters: save.parameters,
      },
    ],
  },
  memberObservations: [],
  tools: [save],
};

/** The Editor Page Object on the page, with its available tool `Editor.save`. */
function registerEditor() {
  vi.mocked(listRegisteredPoms).mockReturnValue([editor]);
  vi.mocked(listAvailablePomTools).mockReturnValue([save] as ReturnType<
    typeof listAvailablePomTools
  >);
  startedAyme.tools.list.mockReturnValue([
    {
      name: save.name,
      description: save.description,
      inputSchema: save.inputSchema,
      group: "pageObject",
      available: true,
    },
  ]);
}

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

function renderApp() {
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }));
  unmounts.push(() => {
    unmount();
    host.remove();
  });
}

/** Unmounts the panel, as a reload does. */
function unmountApp() {
  for (const unmount of unmounts.splice(0)) unmount();
}

afterEach(() => {
  unmountApp();
  vi.clearAllMocks();
  startedAyme.reset();
  localStorage.clear();
  sessionStorage.clear();
});

const callersShown = async () => {
  const count = await inspector.runs.runs.count();
  const callers = [];
  for (let index = 0; index < count; index++)
    callers.push(await inspector.runs.run(index).caller());
  return callers;
};

it("lists every Caller's Runs from the page's Run log, newest first, as they start and end", async () => {
  const byApp = startedAyme.runs.start("snapshot", {}, "support-assistant");
  byApp.succeed({ structure: "" });
  renderApp();
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);

  const byAgent = startedAyme.runs.start("click", { target: "e2" }, "webmcp");

  const click = inspector.runs.latest("click");
  await expect.poll(() => click.status()).toBe("Running");
  expect(await callersShown()).toEqual([
    { icon: "Run by an agent through WebMCP" },
    { text: "support-assistant" },
  ]);
  expect(await click.arguments.textContent()).toBe('{"target":"e2"}');

  byAgent.fail('Ref "e2" does not match a present element.');

  await expect.poll(() => click.status()).toBe("Failed");
  expect(await click.error.textContent()).toBe(
    'Ref "e2" does not match a present element.'
  );
});

it("nests a goal Run's child Runs under it, each with its own Interactions", async () => {
  const goal = startedAyme.runs.start("goal", { goal: "Save" }, "ayme-mcp");
  const fill = startedAyme.runs.start(
    "fill",
    { target: "e3", text: "Draft" },
    { parent: goal.id }
  );
  fill.interact({
    operation: "fill",
    locator: "getByRole('textbox', { name: 'Body' })",
    value: "Draft",
  });
  fill.succeed();
  const click = startedAyme.runs.start(
    "click",
    { target: "e2" },
    { parent: goal.id }
  );
  click.interact({
    operation: "click",
    locator: "getByRole('button', { name: 'Save' })",
  });
  click.succeed();
  goal.succeed({ reason: "done" });
  renderApp();

  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  const run = inspector.runs.latest("goal");
  expect(await run.caller()).toEqual({
    icon: "Run by an agent through Ayme MCP",
  });
  expect(await run.interactions.count()).toBe(0);
  expect(await run.childTools()).toEqual(["fill", "click"]);
  expect(await run.child("fill").interactionList()).toEqual([
    {
      operation: "fill",
      target: "getByRole('textbox', { name: 'Body' })",
      value: '"Draft"',
    },
  ]);
  expect(await run.child("click").interactionList()).toEqual([
    { operation: "click", target: "getByRole('button', { name: 'Save' })" },
  ]);
  expect(await run.child("click").status()).toBe("Succeeded");
});

it("names each Interaction by the member whose locator it names, for any Caller", async () => {
  registerEditor();
  const saveButton = "getByRole('button', { name: 'Save' })";
  vi.mocked(listRegisteredPomTargets).mockResolvedValue([
    { path: "Editor.saveButton", element: document.body, locator: saveButton },
  ]);
  const save = startedAyme.runs.start("Editor.save", {}, "webmcp");
  save.interact({ operation: "click", locator: saveButton });
  save.interact({
    operation: "fill",
    locator: "getByRole('textbox', { name: 'Body' })",
    value: "Draft",
  });
  save.interact({ operation: "keyboard.press", value: "Enter" });
  save.succeed();
  renderApp();

  const run = inspector.runs.latest("Editor.save");
  await expect
    .poll(() => run.interactionList())
    .toEqual([
      { operation: "click", target: "Editor.saveButton" },
      {
        operation: "fill",
        target: "getByRole('textbox', { name: 'Body' })",
        value: '"Draft"',
      },
      { operation: "keyboard.press", target: "", value: '"Enter"' },
    ]);
});

it("names a Browser Tool's Interaction by the member whose element has its ref", async () => {
  registerEditor();
  vi.mocked(listRegisteredPomTargets).mockResolvedValue([
    {
      path: "Editor.saveButton",
      element: document.body,
      locator: "getByRole('button', { name: 'Save' })",
    },
  ]);
  vi.mocked(getPageStateForElements).mockResolvedValue({
    refs: ["e2"],
  } as Awaited<ReturnType<typeof getPageStateForElements>>);
  const click = startedAyme.runs.start("click", { target: "e2" }, "webmcp");
  click.interact({ operation: "click", locator: "locator('aria-ref=e2')" });
  click.succeed();
  renderApp();

  await expect
    .poll(() => inspector.runs.latest("click").interactionList())
    .toEqual([{ operation: "click", target: "Editor.saveButton" }]);
});

it("shows an image a Run returned as itself, with the file Ayme MCP saved it to", async () => {
  const image = {
    type: "image",
    subject: "the viewport",
    filename: "page-1.png",
    mimeType: "image/png",
    width: 2,
    height: 1,
    data: "iVBORw0KGgo=",
  } as const;
  const screenshot = startedAyme.runs.start("screenshot", {}, "ayme-mcp");
  screenshot.succeed(image);
  renderApp();

  const run = inspector.runs.latest("screenshot");
  await expect
    .poll(() => run.image.textContent())
    .toBe("Screenshot of the viewport, 2×1 PNG");
  expect(await run.resultToggle.count()).toBe(0);

  // `ayme mcp` reports the file it saved the image to once the Run ended.
  const reportImage = vi
    .mocked(subscribeToAgentImageRuns)
    .mock.calls.at(-1)![0];
  reportImage({
    name: "screenshot",
    input: {},
    result: image,
    savedTo: "/tmp/ayme-screenshots/page-1.png",
    startedAt: Date.now(),
    durationMs: 1,
  } satisfies AgentImageRun);

  await expect
    .poll(() => run.image.textContent())
    .toBe(
      "Screenshot of the viewport, 2×1 PNG, saved to /tmp/ayme-screenshots/page-1.png"
    );
});

it("shows a tree of Runs in the selection's scope when a child Run is in it", async () => {
  registerEditor();
  const goal = startedAyme.runs.start("goal", { goal: "Save" }, "ayme-mcp");
  startedAyme.runs.start("Editor.save", {}, { parent: goal.id }).succeed();
  goal.succeed({ reason: "done" });
  startedAyme.runs.start("click", { target: "e2" }, "webmcp").succeed();
  renderApp();
  await inspector.navigator.showLens("Model");

  await inspector.navigator.model.object("Editor").click();

  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  const shown = inspector.runs.run(0);
  expect(await shown.root.getAttribute("aria-label")).toBe("goal");
  expect(await shown.childTools()).toEqual(["Editor.save"]);
});

it("records a Tools panel run in the Run log as the Inspector's", async () => {
  registerEditor();
  startedAyme.tools.run.mockResolvedValue({ saved: true });
  renderApp();

  await (await inspector.tool("Editor.save")).run();

  const run = inspector.runs.latest("Editor.save");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual({ icon: "Run by you from the Inspector" });
  expect(startedAyme.runs.list()).toEqual([
    expect.objectContaining({ tool: "Editor.save", by: "inspector" }),
  ]);
});

it("records an App Process tool run from the panel as the Inspector's Run, with no Interactions", async () => {
  startedAyme.appProcessTools.list.mockReturnValue([
    {
      name: "peek.node.jobs",
      description: "Read the current values of a Peek.",
      inputSchema: { type: "object" },
    },
  ]);
  startedAyme.appProcessTools.run.mockResolvedValue({ name: "jobs" });
  renderApp();

  await (await inspector.tool("peek.node.jobs")).run();

  const run = inspector.runs.latest("peek.node.jobs");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual({ icon: "Run by you from the Inspector" });
  expect(await run.interactions.count()).toBe(0);
  expect(startedAyme.runs.list()).toEqual([
    expect.objectContaining({ tool: "peek.node.jobs", by: "inspector" }),
  ]);
});

it("keeps every Caller's rows it showed as earlier page rows after a reload", async () => {
  registerEditor();
  startedAyme.tools.run.mockResolvedValue({ saved: true });
  startedAyme.runs.start("click", { target: "e2" }, "webmcp").succeed();
  renderApp();
  await (await inspector.tool("Editor.save")).run();
  await expect
    .poll(() => inspector.runs.latest("Editor.save").status())
    .toBe("Succeeded");
  await inspector.runs.showAll();
  await expect.poll(() => inspector.runs.runs.count()).toBe(2);

  unmountApp();
  startedAyme.runs.newDocument();
  // The new document's first Run, whose id the log starts over with.
  startedAyme.runs.start("snapshot", {}, "ayme-mcp").succeed({});
  renderApp();

  await expect.poll(() => inspector.runs.runs.count()).toBe(3);
  expect(await callersShown()).toEqual([
    { icon: "Run by an agent through Ayme MCP" },
    { icon: "Run by you from the Inspector" },
    { icon: "Run by an agent through WebMCP" },
  ]);
  expect(await inspector.runs.run(0).earlierPage.count()).toBe(0);
  expect(await inspector.runs.run(1).earlierPage.count()).toBe(1);
  expect(await inspector.runs.run(2).earlierPage.count()).toBe(1);
});

it("scopes every Caller's Runs to the selection", async () => {
  registerEditor();
  startedAyme.runs.start("Editor.save", {}, "ayme-mcp").succeed();
  startedAyme.runs.start("click", { target: "e2" }, "webmcp").succeed();
  renderApp();
  await inspector.navigator.showLens("Model");

  await inspector.navigator.model.object("Editor").click();

  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  expect(await inspector.runs.run(0).caller()).toEqual({
    icon: "Run by an agent through Ayme MCP",
  });
  await inspector.runs.showAll();
  await expect.poll(() => inspector.runs.runs.count()).toBe(2);
});
