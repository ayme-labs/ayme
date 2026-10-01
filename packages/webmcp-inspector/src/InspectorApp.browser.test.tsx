import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import {
  listLiveTools,
  listRegisteredPomTools,
  listRegisteredPoms,
  runTool,
  type RegisteredPom,
} from "@ayme-dev/webmcp/internal";

import { renderInspector } from "./renderInspector";
import { Inspector } from "./testing";

// Component tests of the whole panel, with the skeleton's views in the
// frame, driven through the Inspector POM on playwright-lite. The runtime's
// registry is replaced with fixture Page Objects, so the evidence covers the
// panel and its adapter only.
vi.mock("@ayme-dev/webmcp/internal", () => ({
  getPomDefinitions: vi.fn(() => ({ definitions: [] })),
  peekPageStateForDocument: vi.fn(async () => ({
    text: '- e1 main:\n  - e2 button "Save"',
    elementsByRef: new Map(),
  })),
  listRefToolTargets: vi.fn(async () => new Map()),
  listLiveTools: vi.fn().mockReturnValue([]),
  getPublicationStatus: vi.fn().mockReturnValue({ state: "active" }),
  subscribeToPublishedTools: vi.fn(() => () => {}),
  getPomDefinitionText: vi.fn(() => ""),
  listRegisteredPomTargets: vi.fn(async () => []),
  listRegisteredPomTools: vi.fn(() => []),
  runTool: vi.fn(),
  listRegisteredPoms: vi.fn(() => []),
  subscribeToRegisteredPoms: vi.fn(() => () => true),
}));

function saveTool(
  pomId: string,
  execute: RegisteredPomTool["execute"]
): RegisteredPomTool {
  return {
    pomId,
    methodName: "save",
    name: "Editor.save",
    description: "Save the editor.",
    inputSchema: { type: "object" },
    parameters: [
      {
        name: "mode",
        optional: false,
        schema: { type: "string", enum: ["draft", "final"] },
      },
      { name: "copies", optional: false, schema: { type: "integer" } },
      { name: "notify", optional: true, schema: { type: "boolean" } },
      { name: "title", optional: false, schema: { type: "string" } },
      { name: "meta", optional: true, schema: { type: "object" } },
    ],
    execute,
  };
}

function editor(id: string, tool: RegisteredPomTool): RegisteredPom {
  return {
    id,
    instance: {},
    manifest: {
      className: "Editor",
      members: [{ memberName: "saveButton", kind: "locator", access: "field" }],
      components: [],
      tools: [],
    },
    memberObservations: [
      { memberName: "saveButton", kind: "locator", count: 1 },
    ],
    tools: [tool],
  };
}

function mockRegistry(poms: RegisteredPom[], activeTools: RegisteredPomTool[]) {
  vi.mocked(listRegisteredPoms).mockReturnValue(poms);
  vi.mocked(listRegisteredPomTools).mockReturnValue(activeTools);
}

// The panel renders into an open root this test owns, so the page objects
// reach it without the Playwright selector engine.
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

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.clearAllMocks();
  vi.mocked(listLiveTools).mockReturnValue([]);
  localStorage.clear();
});

describe("the Inspector", () => {
  it("shows a Page Object's members as the page probe found them", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();
    const detail = inspector.detail.model;

    // The file's first test renders the whole panel cold, which can take
    // longer than playwright-lite's 1 s action timeout on a loaded CI runner.
    await inspector.navigator.model.object("Editor").click({ timeout: 5_000 });
    await expect
      .poll(() => detail.memberDescription("saveButton"))
      .toBe("locator · 1 match");
  });

  it("runs a tool with typed arguments and lists the run", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    vi.mocked(runTool).mockResolvedValue({ saved: true });
    renderApp();
    const save = await inspector.tool("Editor.save");

    await save.run({
      mode: "final",
      copies: 3,
      notify: true,
      title: "Release notes",
      meta: { tag: "v1" },
    });

    await expect
      .poll(() => save.lastResult.textContent())
      .toContain("Succeeded");
    expect(runTool).toHaveBeenCalledExactlyOnceWith("Editor.save", {
      mode: "final",
      copies: 3,
      notify: true,
      title: "Release notes",
      meta: { tag: "v1" },
    });
    await expect
      .poll(() => inspector.runs.latest("Editor.save").status())
      .toBe("Succeeded");
  });

  it("shows a run card's last successful run in Runs", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    vi.mocked(runTool).mockResolvedValue({ saved: true });
    renderApp();
    const save = await inspector.tool("Editor.save");
    await save.run({ copies: 1, title: "Notes" });
    await inspector.runs.header.click();
    await expect.poll(() => inspector.runs.runs.count()).toBe(0);

    await save.lastSuccessLink.click();

    await expect
      .poll(() => inspector.runs.latest("Editor.save").status())
      .toBe("Succeeded");
  });

  it("runs a tool the way an agent's call runs and shows its failure", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    vi.mocked(runTool).mockResolvedValue({
      content: [{ type: "text", text: "ToolInputError: title is required." }],
      isError: true,
    });
    renderApp();

    await (await inspector.tool("Editor.save")).run({ copies: 1 });

    const run = inspector.runs.latest("Editor.save");
    await expect.poll(() => run.status()).toBe("Failed");
    expect(await run.error.textContent()).toBe(
      "ToolInputError: title is required."
    );
    expect(runTool).toHaveBeenCalledExactlyOnceWith("Editor.save", {
      mode: "draft",
      copies: 1,
    });
  });

  it("shows a tool the runtime doesn't run as a failed run", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    vi.mocked(runTool).mockRejectedValue(
      Object.assign(new Error('The tool "Editor.save" is not live.'), {
        name: "RuntimeStateError",
      })
    );
    renderApp();

    await (await inspector.tool("Editor.save")).run({ copies: 1 });

    const run = inspector.runs.latest("Editor.save");
    await expect.poll(() => run.status()).toBe("Failed");
    expect(await run.error.textContent()).toBe(
      'RuntimeStateError: The tool "Editor.save" is not live.'
    );
  });

  it("names the page it inspects in the header", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();

    await expect
      .poll(() => inspector.header.pageBadge.textContent())
      .toBe("Editor");
  });

  it("shows the page state an agent receives in the Structure lens", async () => {
    renderApp();

    await inspector.navigator.showLens("Structure");

    await expect
      .poll(() => inspector.pageState.root.textContent())
      .toContain('e2 button "Save"');
    await expect
      .poll(() => inspector.navigator.legend.textContent())
      .toContain("2 refs");
  });

  it("shows whether a registered tool is published, with its schema", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], []);
    renderApp();

    await inspector.tool("Editor.save");

    await expect
      .poll(() => inspector.detail.root.textContent())
      .toContain("unavailable");
    await expect
      .poll(() => inspector.detail.root.textContent())
      .toContain('"type": "object"');
  });

  it("shows a search result in its lens and the detail pane", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();

    await inspector.navigator.search("save the editor");
    await inspector.navigator.result("Editor.save").click();

    await expect
      .poll(() =>
        inspector.navigator.lens("Tools").getAttribute("aria-pressed")
      )
      .toBe("true");
    await expect
      .poll(() =>
        inspector.navigator.item("Editor.save").getAttribute("aria-current")
      )
      .toBe("true");
    await expect.poll(() => inspector.detail.runCard().root.count()).toBe(1);
  });

  it("switches the panel to dark from the header", async () => {
    renderApp();

    await inspector.header.themeSwitch.choose("Dark");

    await expect
      .poll(() => inspector.root.getAttribute("class"))
      .toMatch(/\bdark\b/);
  });
});
