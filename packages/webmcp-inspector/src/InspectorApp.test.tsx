import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import {
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  type RegisteredPom,
} from "@ayme-dev/webmcp/internal";

import { InspectorApp } from "./InspectorApp";

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

async function renderApp() {
  const view = render(<InspectorApp />);
  // Let the first page-state capture settle.
  await act(async () => {});
  return view;
}

function element(selector: string) {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Nothing matches ${selector}`);
  return found;
}

const toolForm = (name: string) => element(`[data-tool-name="${name}"]`);

beforeEach(() => {
  // Radix measures popover content with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InspectorApp", () => {
  it("lists POM classes with member states and pins a member highlight", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    await renderApp();

    expect(element('[data-pom-class="Editor"]').textContent).toContain(
      "Page POM"
    );
    const member = element(
      '[data-pom-class="Editor"] [data-member-name="saveButton"]'
    );
    expect(member.textContent).toContain("present");
    expect(member.dataset.highlightPath).toBe("Editor.saveButton");

    fireEvent.click(member);
    expect(member.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(listRegisteredPomTargets).toHaveBeenCalled());
    fireEvent.click(member);
    expect(member.getAttribute("aria-pressed")).toBe("false");
  });

  it("invokes a tool with typed arguments and records the run", async () => {
    const execute = vi.fn(async () => ({ saved: true }));
    const tool = saveTool("editor", execute);
    mockRegistry([editor("editor", tool)], [tool]);
    await renderApp();

    const form = within(toolForm("Editor.save"));
    fireEvent.change(form.getByLabelText("mode"), { target: { value: "1" } });
    fireEvent.change(form.getByLabelText("copies"), {
      target: { value: "3" },
    });
    fireEvent.click(form.getByLabelText(/^notify/));
    fireEvent.change(form.getByLabelText("title"), {
      target: { value: "Release notes" },
    });
    fireEvent.change(form.getByLabelText(/^meta/), {
      target: { value: '{"tag":"v1"}' },
    });
    fireEvent.click(form.getByRole("button", { name: "Invoke" }));

    expect(await form.findByText(/"saved": true/)).toBeTruthy();
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      mode: "final",
      copies: 3,
      notify: true,
      title: "Release notes",
      meta: { tag: "v1" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    const runs = screen.getByRole("region", { name: "Recent executions" });
    expect(runs.textContent).toContain("Editor.save");
    expect(runs.textContent).toContain("succeeded");
  });

  it("rejects invalid JSON without invoking the tool", async () => {
    const execute = vi.fn(async () => null);
    const tool = saveTool("editor", execute);
    mockRegistry([editor("editor", tool)], [tool]);
    await renderApp();

    const form = within(toolForm("Editor.save"));
    fireEvent.change(form.getByLabelText(/^meta/), {
      target: { value: "{" },
    });
    fireEvent.click(form.getByRole("button", { name: "Invoke" }));

    expect(form.getByRole("alert").textContent).toBe("meta: enter valid JSON.");
    expect(execute).not.toHaveBeenCalled();
  });

  it("invokes the active registration when tool names collide", async () => {
    const inactiveExecute = vi.fn(async () => null);
    const activeExecute = vi.fn(async () => null);
    const inactiveTool = saveTool("inactive", inactiveExecute);
    const activeTool = saveTool("active", activeExecute);
    mockRegistry(
      [editor("inactive", inactiveTool), editor("active", activeTool)],
      [activeTool]
    );
    await renderApp();

    fireEvent.click(
      within(toolForm("Editor.save")).getByRole("button", { name: "Invoke" })
    );

    await waitFor(() => expect(activeExecute).toHaveBeenCalledOnce());
    expect(inactiveExecute).not.toHaveBeenCalled();
  });

  it("shows the model's page state and registered tools", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], []);
    await renderApp();

    fireEvent.click(screen.getByRole("tab", { name: "Model view" }));

    const pageState = screen.getByRole("region", {
      name: "Structural page state",
    });
    expect(await within(pageState).findByText(/button "Save"/)).toBeTruthy();
    const registered = element('[data-registered-tool="Editor.save"]');
    expect(registered.textContent).toContain("unavailable");
    expect(registered.textContent).toContain('"type": "object"');
  });

  it("collapses to a logo FAB and restores the panel", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Collapse inspector" }));

    expect(
      screen.queryByRole("complementary", { name: "Ayme Inspector" })
    ).toBeNull();
    const fab = screen.getByRole("button", { name: "Open Ayme POM inspector" });
    expect(document.activeElement).toBe(fab);
    const mark = fab.querySelector("svg path");
    expect(fab.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 165.84 136"
    );
    expect(mark?.getAttribute("fill")).toBe("#6936F1");
    expect(mark?.getAttribute("d")).toContain("M120.57 131.59");

    fireEvent.click(fab);

    expect(
      screen.getByRole("complementary", { name: "Ayme Inspector" })
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Collapse inspector" })
    );
  });

  it("switches to dark mode from a theme menu portalled into its own root", async () => {
    const { container } = await renderApp();
    const root = container.querySelector("[data-ayme-inspector-root]");
    expect(root?.classList.contains("dark")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    const dark = await screen.findByRole("button", { name: "Dark" });
    expect(dark.closest("[data-ayme-inspector-portal]")?.parentElement).toBe(
      root
    );
    fireEvent.click(dark);

    expect(root?.classList.contains("dark")).toBe(true);
  });
});
