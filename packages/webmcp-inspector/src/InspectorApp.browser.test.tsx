import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import {
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  type RegisteredPom,
} from "@ayme-dev/webmcp/internal";

import { renderInspector } from "./renderInspector";
import { Inspector } from "./testing";

// Component tests of the skeleton panel, driven through the Inspector POM on
// playwright-lite. The runtime's registry is replaced with fixture Page
// Objects, so the evidence covers the panel only.
vi.mock("@ayme-dev/webmcp/internal", () => ({
  capturePageState: vi.fn(async () => '- main:\n  - button "Save"'),
  getPageStateForElements: vi.fn(async () => ({
    state: { resolve: async () => [] },
    refs: [],
  })),
  listRegisteredPomTargets: vi.fn(async () => []),
  listRegisteredPomTools: vi.fn(() => []),
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

const inspector = new Inspector(createPage());
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
});

describe("the skeleton Inspector", () => {
  it("shows a Page Object Model's member state and pins its highlight", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();
    const card = inspector.pageObjects.pomClass("Editor");

    await expect
      .poll(() => card.memberState("saveButton").textContent())
      .toBe("present");
    await card.member("saveButton").click();

    await expect
      .poll(() => card.member("saveButton").getAttribute("aria-pressed"))
      .toBe("true");
    await expect.poll(() => listRegisteredPomTargets).toHaveBeenCalled();
    await card.member("saveButton").click();
    await expect
      .poll(() => card.member("saveButton").getAttribute("aria-pressed"))
      .toBe("false");
  });

  it("runs a tool with typed arguments and lists the run", async () => {
    const execute = vi.fn(async () => ({ saved: true }));
    const tool = saveTool("editor", execute);
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();
    const save = inspector.pageObjects.tool("Editor.save");

    await save.run({
      mode: "final",
      copies: 3,
      notify: true,
      title: "Release notes",
      meta: { tag: "v1" },
    });

    await expect
      .poll(() => save.lastResult.textContent())
      .toContain('"saved": true');
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      mode: "final",
      copies: 3,
      notify: true,
      title: "Release notes",
      meta: { tag: "v1" },
    });
    await inspector.showView("Runs");
    const run = inspector.runs.runsOf("Editor.save");
    await expect
      .poll(() => inspector.runs.status(run).textContent())
      .toBe("succeeded");
  });

  it("rejects invalid JSON without running the tool", async () => {
    const execute = vi.fn(async () => null);
    const tool = saveTool("editor", execute);
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();
    const save = inspector.pageObjects.tool("Editor.save");

    await save.run({ meta: "{" });

    await expect
      .poll(() => save.error.textContent())
      .toBe("meta: enter valid JSON.");
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs the active registration when tool names collide", async () => {
    const inactiveExecute = vi.fn(async () => null);
    const activeExecute = vi.fn(async () => null);
    const inactiveTool = saveTool("inactive", inactiveExecute);
    const activeTool = saveTool("active", activeExecute);
    mockRegistry(
      [editor("inactive", inactiveTool), editor("active", activeTool)],
      [activeTool]
    );
    renderApp();

    await inspector.pageObjects.tool("Editor.save").runButton.first().click();

    await expect.poll(() => activeExecute).toHaveBeenCalledOnce();
    expect(inactiveExecute).not.toHaveBeenCalled();
  });

  it("shows the model's page state and registered tools", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], []);
    renderApp();

    await inspector.showView("Model view");

    await expect
      .poll(() => inspector.modelView.pageState.textContent())
      .toContain('button "Save"');
    const registered = inspector.modelView.registeredTool("Editor.save");
    await expect.poll(() => registered.textContent()).toContain("unavailable");
    await expect
      .poll(() => registered.textContent())
      .toContain('"type": "object"');
  });

  it("collapses to the logo and opens again", async () => {
    renderApp();

    await inspector.collapse();

    await expect.poll(() => inspector.panel.count()).toBe(0);
    await expect.poll(() => inspector.logo.root.isVisible()).toBe(true);
    await inspector.logo.open();
    await expect.poll(() => inspector.panel.isVisible()).toBe(true);
  });

  it("switches to dark from a theme menu that opens inside the panel's root", async () => {
    renderApp();
    const menu = inspector.header.themeMenu;

    await menu.choose("Dark");

    await expect
      .poll(() => inspector.root.getAttribute("class"))
      .toMatch(/\bdark\b/);
    await expect.poll(() => menu.trigger.textContent()).toBe("Theme: Dark");
  });
});
