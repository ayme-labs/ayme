import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { Interaction, RegisteredPomTool } from "@ayme-dev/ayme";
import type {
  InspectorAgentImageRun as AgentImageRun,
  InspectorPageObject,
} from "@ayme-dev/ayme/inspector";

import { forest, node } from "../structure/test-utils/projected";
import {
  lookOf,
  startedAyme,
  type PageFixture,
} from "../tools/test-utils/startedAyme";
import { renderInspector } from "./renderInspector";
import { Inspector } from "../testing";

// Component tests: Runs reading the page's Run log, with fixture Runs by
// several Callers, driven through the Inspector POM on playwright-lite. The
// runtime is replaced by a stand-in session whose Run log the test fills,
// and which records the panel's own runs there for the Caller they name.
const save: RegisteredPomTool = {
  rooted: false,
  className: "Editor",
  methodName: "save",
  name: "Editor.save",
  authorDescription: "Save the editor.",
  agentDescription: "Save the editor.",
  inputSchema: { type: "object" },
  parameters: [],
};
const editor: InspectorPageObject = {
  id: "Editor",
  manifest: {
    className: "Editor",
    members: [{ memberName: "saveButton", kind: "locator", access: "field" }],
    components: [],
    tools: [
      {
        methodName: save.methodName,
        toolName: save.name,
        description: save.authorDescription,
        parameters: save.parameters,
      },
    ],
  },
  memberObservations: [],
  presentPaths: [""],
  rootMemberPaths: [],
  tools: [save],
};

/** The Editor Page Object on the page, with its available tool `Editor.save`. */
function registerEditor() {
  startedAyme.setRegistry({ pageObjects: [editor] });
  startedAyme.tools.list.mockReturnValue([
    {
      name: save.name,
      authorDescription: save.authorDescription,
      agentDescription: save.agentDescription,
      inputSchema: save.inputSchema,
      group: "pageObject",
      className: save.className,
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
// The page as the look gives it, which a test may change.
let pageFixture: PageFixture;
const setTargets = (targets: PageFixture["targets"]) => {
  pageFixture = { ...pageFixture, targets };
  startedAyme.setPage(pageFixture);
};
const setElements = (elementsByRef: PageFixture["elementsByRef"]) => {
  pageFixture = { ...pageFixture, elementsByRef };
  startedAyme.setPage(pageFixture);
};

beforeEach(() => {
  pageFixture = {
    projected: forest(
      node(
        { ref: "e1", role: "main" },
        node({ ref: "e2", role: "button", name: "Save" })
      )
    ),
    elementsByRef: new Map(),
  };
  startedAyme.setPage(pageFixture);
});

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
  expect(await click.arguments.count()).toBe(0);
  expect(await click.toggle.textContent()).toContain("e2");

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
  expect(await run.child("fill").toggle.textContent()).toContain(
    "getByRole('textbox', { name: 'Body' })"
  );
  expect(await run.child("fill").toggle.textContent()).toContain('"Draft"');
  expect(await run.child("fill").interactions.count()).toBe(0);
  expect(await run.child("click").toggle.textContent()).toContain(
    "getByRole('button', { name: 'Save' })"
  );
  expect(await run.child("click").interactions.count()).toBe(0);
  expect(await run.child("click").status()).toBe("Succeeded");
});

it("names each Interaction by the member whose locator it names, for any Caller", async () => {
  registerEditor();
  const saveButton = "getByRole('button', { name: 'Save' })";
  setTargets([
    { path: "Unknown.button", element: document.body, locator: saveButton },
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
  const shown = await run.interactionList();
  startedAyme.runs.start("snapshot", {}, "webmcp").succeed();
  await expect
    .poll(() => inspector.runs.latest("snapshot").status())
    .toBe("Succeeded");
  await expect.poll(() => run.interactionList()).toEqual(shown);
});

it("names an Interaction on a Locator collection holding one element by that element", async () => {
  registerEditor();
  startedAyme.setRegistry({
    pageObjects: [
      {
        ...editor,
        manifest: {
          ...editor.manifest,
          members: [
            {
              memberName: "buttons",
              kind: "locator",
              access: "field",
              collection: true,
            },
          ],
        },
        memberObservations: [
          { memberName: "buttons", kind: "locator", access: "field", count: 1 },
        ],
      },
    ],
  });
  setTargets([
    {
      path: "Editor.buttons[0]",
      element: document.body,
      locator: "locator('button').first()",
      aliases: ["locator('button')", "locator('button').last()"],
    },
  ]);
  const save = startedAyme.runs.start("Editor.save", {}, "webmcp");
  save.interact({ operation: "click", locator: "locator('button')" });
  save.interact({ operation: "click", locator: "locator('button').first()" });
  save.succeed();
  renderApp();

  await expect
    .poll(() => inspector.runs.latest("Editor.save").interactionList())
    .toEqual([
      { operation: "click", target: "Editor.buttons[0]" },
      { operation: "click", target: "Editor.buttons[0]" },
    ]);
});

it("names an Interaction on a Locator collection's last element by that element", async () => {
  registerEditor();
  startedAyme.setRegistry({
    pageObjects: [
      {
        ...editor,
        manifest: {
          ...editor.manifest,
          members: [
            {
              memberName: "buttons",
              kind: "locator",
              access: "field",
              collection: true,
            },
          ],
        },
        memberObservations: [
          { memberName: "buttons", kind: "locator", access: "field", count: 2 },
        ],
      },
    ],
  });
  setTargets([
    {
      path: "Editor.buttons[0]",
      element: document.body,
      locator: "locator('button').first()",
      aliases: [],
    },
    {
      path: "Editor.buttons[1]",
      element: document.body,
      locator: "locator('button').nth(1)",
      aliases: ["locator('button').last()"],
    },
  ]);
  const save = startedAyme.runs.start("Editor.save", {}, "webmcp");
  save.interact({ operation: "click", locator: "locator('button').last()" });
  save.interact({ operation: "click", locator: "locator('button').nth(1)" });
  save.succeed();
  renderApp();

  await expect
    .poll(() => inspector.runs.latest("Editor.save").interactionList())
    .toEqual([
      { operation: "click", target: "Editor.buttons[1]" },
      { operation: "click", target: "Editor.buttons[1]" },
    ]);
});

it("names a Browser Tool's Interaction by the member whose element has its ref, not by another member", async () => {
  registerEditor();
  const body = document.createElement("textarea");
  const button = document.createElement("button");
  document.body.append(body, button);
  unmounts.push(() => {
    body.remove();
    button.remove();
  });
  startedAyme.setRegistry({
    pageObjects: [
      {
        ...editor,
        manifest: {
          ...editor.manifest,
          members: [
            { memberName: "bodyInput", kind: "locator", access: "field" },
            ...editor.manifest.members,
          ],
        },
      },
    ],
  });
  setTargets([
    {
      path: "Editor.bodyInput",
      element: body,
      locator: "getByRole('textbox', { name: 'Body' })",
    },
    {
      path: "Editor.saveButton",
      element: button,
      locator: "getByRole('button', { name: 'Save' })",
    },
  ]);
  setElements(
    new Map<NonNullable<Interaction["ref"]>, Element>([
      ["e1" as NonNullable<Interaction["ref"]>, body],
      ["e2" as NonNullable<Interaction["ref"]>, button],
    ])
  );
  const click = startedAyme.runs.start("click", { target: "e2" }, "webmcp");
  click.interact({
    operation: "click",
    locator: "locator('aria-ref=e2')",
    ref: "e2" as Interaction["ref"],
  });
  click.succeed();
  renderApp();

  await expect
    .poll(() => inspector.runs.latest("click").toggle.textContent())
    .toContain("Editor.saveButton");
});

it("names a Browser Tool's Interaction by the member whose element has its ref", async () => {
  registerEditor();
  setTargets([
    {
      path: "Editor.saveButton",
      element: document.body,
      locator: "getByRole('button', { name: 'Save' })",
    },
  ]);
  setElements(
    new Map([["e2" as NonNullable<Interaction["ref"]>, document.body]])
  );
  const click = startedAyme.runs.start("click", { target: "e2" }, "webmcp");
  click.interact({
    operation: "click",
    locator: "locator('aria-ref=e2')",
    ref: "e2" as Interaction["ref"],
  });
  click.succeed();
  renderApp();

  await expect
    .poll(() => inspector.runs.latest("click").toggle.textContent())
    .toContain("Editor.saveButton");
});

/** The page state the runtime last recorded, with one `role` node named `name` at `ref`. */
function recordPage(ref: string, role: string, name: string) {
  startedAyme.recordedPage = {
    projected: forest(node({ ref, role: role as never, name })),
    refs: [ref],
  };
}

it("names a newly added target from the recorded page state before the Inspector's look catches up", async () => {
  recordPage("e99", "button", "Dismiss notice");
  const click = startedAyme.runs.start("click", { target: "e99" }, "webmcp");
  click.interact({
    operation: "click",
    locator: "locator('aria-ref=e99')",
    ref: "e99" as Interaction["ref"],
  });
  click.succeed();
  renderApp();
  await expect
    .poll(() => inspector.runs.latest("click").toggle.textContent())
    .toContain('button "Dismiss notice"');
});

it("captures a member before input and preserves it through later interactions and run-end resolution", async () => {
  registerEditor();
  startedAyme.setRegistry({
    pageObjects: [
      {
        ...editor,
        manifest: {
          ...editor.manifest,
          members: [
            ...editor.manifest.members,
            { memberName: "otherButton", kind: "locator", access: "field" },
          ],
        },
      },
    ],
  });
  const button = document.createElement("button");
  document.body.append(button);
  unmounts.push(() => button.remove());
  setTargets([
    { path: "Editor.saveButton", element: button, locator: "saveButton" },
  ]);
  setElements(new Map([["e2" as NonNullable<Interaction["ref"]>, button]]));
  recordPage("e2", "button", "Original");
  renderApp();
  await inspector.navigator.showLens("Structure");
  await inspector.structure.pick("e2");
  const save = startedAyme.runs.start("Editor.save", {}, "webmcp");
  save.interact({
    operation: "click",
    locator: "different locator spelling",
    ref: "e2" as Interaction["ref"],
  });
  const run = inspector.runs.latest("Editor.save");
  await expect
    .poll(() => run.interactionList())
    .toEqual([{ operation: "click", target: "Editor.saveButton" }]);
  recordPage("e99", "button", "Changed");
  save.interact({
    operation: "click",
    locator: "another button",
    ref: "e99" as Interaction["ref"],
  });
  setTargets([
    { path: "Editor.otherButton", element: button, locator: "saveButton" },
  ]);
  save.succeed();
  await expect
    .poll(() => run.interactionList())
    .toEqual([
      { operation: "click", target: "Editor.saveButton" },
      { operation: "click", target: 'button "Changed"' },
    ]);
  // The persisted row must retain the pre-input description as well as its member.
  await expect
    .poll(
      () => JSON.parse(sessionStorage.getItem("ayme-inspector:runs") ?? "[]")[0]
    )
    .toMatchObject({
      className: "Editor",
      interactions: [
        { target: 'button "Original"' },
        { target: 'button "Changed"' },
      ],
    });
});

it("does not invent a generic name for an unnamed target", async () => {
  recordPage("e99", "generic", "");
  renderApp();
  await expect.poll(() => inspector.runs.runs.count()).toBe(0);
  const click = startedAyme.runs.start("click", { target: "e99" }, "webmcp");
  click.interact({
    operation: "click",
    locator: "locator('aria-ref=e99')",
    ref: "e99" as Interaction["ref"],
  });
  click.succeed();
  await expect
    .poll(() => inspector.runs.latest("click").toggle.textContent())
    .toContain("e99");
  expect(
    await inspector.runs.latest("click").toggle.textContent()
  ).not.toContain("generic");
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
  startedAyme.reportAgentImageRun({
    name: "screenshot",
    input: {},
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

it("scopes root-less class runs to their own Page Object", async () => {
  registerEditor();
  const other = { ...save, name: "Other.save", className: "Other" };
  startedAyme.tools.list.mockReturnValue([
    ...startedAyme.tools.list(),
    {
      name: other.name,
      inputSchema: other.inputSchema,
      group: "pageObject",
      className: other.className,
      available: true,
    },
  ]);
  startedAyme.setRegistry({
    pageObjects: [
      editor,
      {
        ...editor,
        id: "Other",
        manifest: {
          ...editor.manifest,
          className: "Other",
          tools: [
            { methodName: "save", toolName: "Other.save", parameters: [] },
          ],
        },
        tools: [other],
      },
    ],
  });
  startedAyme.runs.start("Editor.save", {}, "webmcp").succeed();
  startedAyme.runs.start("Other.save", {}, "webmcp").succeed();
  renderApp();
  await inspector.navigator.showLens("Model");
  await inspector.navigator.model.object("Editor").click();
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  expect(await inspector.runs.run(0).root.getAttribute("aria-label")).toBe(
    "Editor.save"
  );
});

it("keeps a root-less run's class when remounting after its tool disappeared", async () => {
  registerEditor();
  startedAyme.runs.start("Editor.save", {}, "webmcp").succeed();
  renderApp();
  await inspector.navigator.showLens("Model");
  await inspector.navigator.model.object("Editor").click();
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  unmountApp();
  startedAyme.tools.list.mockReturnValue([]);
  renderApp();
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  expect(await inspector.runs.run(0).root.getAttribute("aria-label")).toBe(
    "Editor.save"
  );
});

it("finds a root-less class run from a structure node belonging to that class", async () => {
  registerEditor();
  const app = document.createElement("main");
  app.innerHTML = "<button>Save</button>";
  document.body.append(app);
  unmounts.push(() => app.remove());
  const button = app.querySelector("button")!;
  pageFixture = {
    projected: forest(
      node(
        { ref: "e1", role: "main" },
        node({ ref: "e2", role: "button", name: "Save" })
      )
    ),
    elementsByRef: new Map([
      ["e1", app],
      ["e2", button],
    ]),
  };
  startedAyme.setPage(pageFixture);
  setTargets([
    {
      path: "Editor.saveButton",
      element: button,
      locator: "getByRole('button', {name:'Save'})",
    },
  ]);
  startedAyme.runs.start("Editor.save", {}, "webmcp").succeed();
  renderApp();
  await inspector.navigator.showLens("Structure");
  await inspector.structure.pick("e2");
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  expect(await inspector.runs.run(0).root.getAttribute("aria-label")).toBe(
    "Editor.save"
  );
});

it("discards pending target descriptions when the log drops their run", async () => {
  const unhandled = vi.fn();
  window.addEventListener("unhandledrejection", unhandled);
  unmounts.push(() =>
    window.removeEventListener("unhandledrejection", unhandled)
  );
  renderApp();
  await inspector.navigator.showLens("Structure");
  await inspector.structure.pick("e2");
  await inspector.runs.showAll();
  const click = startedAyme.runs.start("click", { target: "e2" }, "webmcp");
  click.interact({
    operation: "click",
    locator: "saveButton",
    ref: "e2" as Interaction["ref"],
  });
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  const pending = Promise.withResolvers<void>();
  startedAyme.look = async () => {
    await pending.promise;
    return lookOf(pageFixture);
  };
  click.succeed();
  startedAyme.runs.newDocument();
  await expect.poll(() => inspector.runs.runs.count()).toBe(0);
  await expect
    .poll(() => sessionStorage.getItem("ayme-inspector:runs"))
    .toBe("[]");
  pending.resolve();
  startedAyme.runs.start("snapshot", {}, "webmcp").succeed();
  await expect
    .poll(() => inspector.runs.latest("snapshot").status())
    .toBe("Succeeded");
  expect(await inspector.runs.runs.count()).toBe(1);
  // The browser runner logs unhandled rejections without failing the test.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(unhandled).not.toHaveBeenCalled();
});
