import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { ToolInputError, type RegisteredPomTool } from "@ayme-dev/ayme";
import {
  listRegisteredPomTools,
  listRegisteredPoms,
  type RegisteredPom,
} from "@ayme-dev/ayme/internal";

import { renderInspector } from "./renderInspector";
import { startedAyme } from "../tools/test-utils/startedAyme";
import { Inspector } from "../testing";

// Component tests of the whole panel, driven through the Inspector POM on
// playwright-lite. The runtime's
// registry is replaced with fixture Page Objects, so the evidence covers the
// panel and its runtime wiring only.
vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { asStartedAyme } = await import("../tools/test-utils/startedAyme");
  const { pageStateNodeEntry } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  const { forest, node } = await import("../structure/test-utils/projected");
  return {
    pageStateNodeEntry,
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
    listRegisteredPomTargets: vi.fn(async () => []),
    listRegisteredPomTools: vi.fn(() => []),
    getStartedAyme: asStartedAyme,
    subscribeToStartedAyme: () => () => {},
    listRegisteredPoms: vi.fn(() => []),
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

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

function editor(id: string, ...tools: RegisteredPomTool[]): RegisteredPom {
  return {
    id,
    instance: {},
    manifest: {
      className: "Editor",
      members: [{ memberName: "saveButton", kind: "locator", access: "field" }],
      components: [],
      tools: tools.map((tool) => ({
        methodName: tool.methodName,
        toolName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        parameters: tool.parameters,
      })),
    },
    memberObservations: [
      { memberName: "saveButton", kind: "locator", count: 1 },
    ],
    tools,
  };
}

function mockRegistry(poms: RegisteredPom[], activeTools: RegisteredPomTool[]) {
  vi.mocked(listRegisteredPoms).mockReturnValue(poms);
  vi.mocked(listRegisteredPomTools).mockReturnValue(activeTools);
  startedAyme.tools.list.mockReturnValue(
    activeTools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
      group: "pageObject",
    }))
  );
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

const publicationActive = { state: "active", message: "" } as const;
const publicationDisabled = {
  state: "disabled",
  message: "WebMCP publication is disabled.",
} as const;

afterEach(() => {
  startedAyme.webMCP.publicationStatus = publicationActive;
  for (const unmount of unmounts.splice(0)) unmount();
  vi.clearAllMocks();
  startedAyme.reset();
  localStorage.clear();
  sessionStorage.clear();
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
    startedAyme.tools.run.mockResolvedValue({ saved: true });
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
    expect(startedAyme.tools.run).toHaveBeenCalledExactlyOnceWith(
      "Editor.save",
      {
        mode: "final",
        copies: 3,
        notify: true,
        title: "Release notes",
        meta: { tag: "v1" },
      }
    );
    await expect
      .poll(() => inspector.runs.latest("Editor.save").status())
      .toBe("Succeeded");
  });

  it("shows a run card's last successful run in Runs, with its result", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    startedAyme.tools.run.mockResolvedValue({ saved: true });
    renderApp();
    const save = await inspector.tool("Editor.save");
    await save.run({ copies: 1, title: "Notes" });
    const run = inspector.runs.latest("Editor.save");
    await expect.poll(() => run.status()).toBe("Succeeded");
    await run.toggle.click();
    await inspector.runs.header.click();
    await expect.poll(() => inspector.runs.runs.count()).toBe(0);

    await save.lastSuccessLink.click();

    await expect
      .poll(() => run.result.textContent())
      .toBe(JSON.stringify({ saved: true }, null, 2));
  });

  it("shows the last success's result after a failed run", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    startedAyme.tools.run
      .mockResolvedValueOnce({ saved: 1 })
      .mockRejectedValueOnce(new Error("Not saved."));
    renderApp();
    const save = await inspector.tool("Editor.save");
    await save.run({ copies: 1, title: "Notes" });
    await expect.poll(() => inspector.runs.run(0).status()).toBe("Succeeded");
    await save.runButton.click();
    await expect.poll(() => inspector.runs.run(0).status()).toBe("Failed");

    await save.lastSuccessLink.click();

    expect(await save.lastSuccessLink.textContent()).toBe("Last success ›");
    await expect
      .poll(() => inspector.runs.run(1).result.textContent())
      .toBe(JSON.stringify({ saved: 1 }, null, 2));
    expect(await inspector.runs.run(0).error.textContent()).toBe("Not saved.");
    expect(await inspector.runs.run(0).resultToggle.count()).toBe(0);
  });

  it("keeps each run's result as the tool returned it", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    const first = { saved: 1 };
    startedAyme.tools.run
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ saved: 2 });
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderApp();
    const save = await inspector.tool("Editor.save");
    await save.run({ copies: 1, title: "Notes" });
    await expect.poll(() => inspector.runs.run(0).status()).toBe("Succeeded");

    // The tool changes the object it returned, then runs again.
    first.saved = 99;
    await save.runButton.click();
    await expect.poll(() => inspector.runs.runs.count()).toBe(2);
    await expect.poll(() => inspector.runs.run(0).status()).toBe("Succeeded");

    const earlier = inspector.runs.run(1);
    expect(await earlier.resultText()).toBe(
      JSON.stringify({ saved: 1 }, null, 2)
    );
    await earlier.copyResultButton.click();
    expect(writeText).toHaveBeenLastCalledWith(
      JSON.stringify({ saved: 1 }, null, 2)
    );
    expect(await inspector.runs.run(0).resultText()).toBe(
      JSON.stringify({ saved: 2 }, null, 2)
    );
    expect(startedAyme.tools.run).toHaveBeenCalledTimes(2);
    writeText.mockRestore();
  });

  it("gives overlapping runs their own results", async () => {
    const save = saveTool("editor", vi.fn());
    const publish: RegisteredPomTool = {
      ...saveTool("editor", vi.fn()),
      methodName: "publish",
      name: "Editor.publish",
      description: "Publish the editor.",
    };
    mockRegistry([editor("editor", save, publish)], [save, publish]);
    const settle = new Map<string, (result: unknown) => void>();
    startedAyme.tools.run.mockImplementation(
      (name) => new Promise((resolve) => settle.set(name, resolve))
    );
    renderApp();
    await (await inspector.tool("Editor.save")).run({ copies: 1, title: "A" });
    await (
      await inspector.tool("Editor.publish")
    ).run({ copies: 2, title: "B" });
    await expect.poll(() => settle.size).toBe(2);
    await inspector.runs.showAll();
    const saveRun = inspector.runs.latest("Editor.save");
    const publishRun = inspector.runs.latest("Editor.publish");

    // The later call returns first.
    settle.get("Editor.publish")!({ published: true });
    await expect.poll(() => publishRun.status()).toBe("Succeeded");
    expect(await saveRun.status()).toBe("Running");
    settle.get("Editor.save")!({ saved: true });
    await expect.poll(() => saveRun.status()).toBe("Succeeded");

    expect(await saveRun.resultText()).toBe(
      JSON.stringify({ saved: true }, null, 2)
    );
    expect(await publishRun.resultText()).toBe(
      JSON.stringify({ published: true }, null, 2)
    );
  });

  it("lists two registrations of one page class apart and runs their tool as the runtime does", async () => {
    const consoleError = vi.spyOn(console, "error");
    const first = saveTool("first", vi.fn());
    const second = saveTool("second", vi.fn());
    mockRegistry([editor("first", first), editor("second", second)], [second]);
    startedAyme.tools.run.mockResolvedValue({ saved: true });
    renderApp();

    await expect
      .poll(() => inspector.navigator.model.object("Editor").count())
      .toBe(2);
    await inspector.navigator.model.object("Editor").last().click();
    await inspector.detail.runCard("save").run({ copies: 1, title: "Notes" });

    await expect.poll(() => startedAyme.tools.run).toHaveBeenCalledOnce();
    expect(startedAyme.tools.run).toHaveBeenCalledWith("Editor.save", {
      mode: "draft",
      copies: 1,
      title: "Notes",
    });
    expect(
      consoleError.mock.calls.filter(([message]) =>
        String(message).includes("same key")
      )
    ).toEqual([]);
    consoleError.mockRestore();
  });

  it("runs a tool through the session and shows its failure as an agent reads it", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    startedAyme.tools.run.mockRejectedValue(
      new ToolInputError("title is required.")
    );
    renderApp();

    await (await inspector.tool("Editor.save")).run({ copies: 1 });

    const run = inspector.runs.latest("Editor.save");
    await expect.poll(() => run.status()).toBe("Failed");
    expect(await run.error.textContent()).toBe(
      "ToolInputError: title is required."
    );
    expect(startedAyme.tools.run).toHaveBeenCalledExactlyOnceWith(
      "Editor.save",
      {
        mode: "draft",
        copies: 1,
      }
    );
  });

  it("shows a tool the runtime doesn't run as a failed run", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    startedAyme.tools.run.mockRejectedValue(
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

    await expect.poll(() => inspector.structure.node("e2").count()).toBe(1);
    await expect
      .poll(() => inspector.navigator.legend.textContent())
      .toContain("2 refs");
  });

  it("lists the live tools when nothing is published", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    startedAyme.webMCP.publicationStatus = publicationDisabled;
    renderApp();

    await inspector.navigator.showLens("Tools");

    await expect
      .poll(() => inspector.navigator.tools.listed())
      .toEqual({ "Page object tools": ["Editor.save"] });
  });

  it("drops an open tool that stops being live and shows the page", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    renderApp();
    await inspector.tool("Editor.save");
    await expect
      .poll(() => inspector.detail.toolPage.title.textContent())
      .toBe("Editor.save");

    mockRegistry([editor("editor", tool)], []);
    startedAyme.announce();

    await expect
      .poll(() => inspector.navigator.tools.tool("Editor.save").count())
      .toBe(0);
    await expect
      .poll(() => inspector.detail.model.instance("Editor").count())
      .toBe(1);
    expect(await inspector.detail.toolPage.root.count()).toBe(0);
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

  it("comes back to the lens, the open tool and its runs after a reload", async () => {
    const tool = saveTool("editor", vi.fn());
    mockRegistry([editor("editor", tool)], [tool]);
    startedAyme.tools.run.mockResolvedValue({ saved: true });
    renderApp();
    const save = await inspector.tool("Editor.save");
    await save.run({ copies: 1, title: "Notes" });
    await expect
      .poll(() => inspector.runs.latest("Editor.save").status())
      .toBe("Succeeded");

    for (const unmount of unmounts.splice(0)) unmount();
    renderApp();

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
    await expect
      .poll(() => inspector.runs.latest("Editor.save").status())
      .toBe("Succeeded");
  });

  it("switches the panel to dark from the header", async () => {
    renderApp();

    await inspector.header.themeSwitch.choose("Dark");

    await expect
      .poll(() => inspector.container.getAttribute("class"))
      .toMatch(/\bdark\b/);
  });
});
