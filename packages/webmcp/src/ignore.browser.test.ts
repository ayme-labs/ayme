import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { createPage } from "./browserPage";
import ayme from "./index";
import {
  createPageRegistration,
  listRegisteredPomTools,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import { createRuntimeSession } from "./runtime";
import type { PomManifest, ToolManifest } from "./contracts";

const action = (methodName: string, toolName = methodName): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  parameters: [],
});
const root = () =>
  ({ memberName: "root", kind: "locator", access: "field" }) as const;
const manifest = (
  className: string,
  members: PomManifest["members"],
  tools: ToolManifest[] = []
): PomManifest => ({
  className,
  members,
  tools,
  components: [],
});

describe("ignore predicate in page state capture", () => {
  let page: ReturnType<typeof createPage>;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  function startRuntime(ignore?: (element: Element) => boolean) {
    const runtime = createRuntimeSession(page, { ignore });
    stop = runtime.start();
    return runtime;
  }

  it("drops ignored subtrees from get_page_context and unresolved refs", async () => {
    document.body.innerHTML = `
      <main>
        <button id="save">Save changes</button>
        <aside id="assistant"><button id="help">Get help</button></aside>
      </main>
    `;
    startRuntime((element) => element.id === "assistant");

    const context = await ayme.getPageContext();
    expect(context.structure).toContain("Save changes");
    expect(context.structure).not.toContain("Get help");
    expect(structuralRefFor(context.structure, "Get help")).toBeUndefined();

    const saveRef = structuralRefFor(context.structure, "Save changes");
    if (!saveRef) throw new Error("Expected a ref for Save changes.");
    await expect(context.resolve(saveRef)).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: saveRef,
        node: { ref: saveRef, element: document.querySelector("#save") },
      },
    ]);
  });

  it("drops a nested present Page Object Root inside an ignored element", async () => {
    document.body.innerHTML = `
      <div id="assistant">
        <section id="panel"><button>Panel action</button></section>
      </div>
      <button id="main">Main action</button>
    `;
    class Panel {
      root = page.locator("#panel");
      act() {}
    }
    registerCompiledPom(
      Panel,
      manifest("Panel", [root()], [action("act", "Panel.act")])
    );
    startRuntime((element) => element.id === "assistant");
    createPageRegistration(Panel);

    await probeRegisteredPomMembers();
    const state = await ayme.getPageState();
    expect(state.text).toContain("Main action");
    expect(state.text).not.toMatch(/Panel(?:\.|:)/);
    expect(state.text).not.toContain("Panel action");
  });

  it("does not hide ignored content from tool publication", async () => {
    document.body.innerHTML = `
      <div id="assistant">
        <section id="panel"><button>Panel action</button></section>
      </div>
    `;
    class Panel {
      root = page.locator("#panel");
      act() {}
    }
    registerCompiledPom(
      Panel,
      manifest("Panel", [root()], [action("act", "Panel.act")])
    );
    startRuntime((element) => element.id === "assistant");
    createPageRegistration(Panel);

    await probeRegisteredPomMembers();
    expect(listRegisteredPomTools().map((tool) => tool.name)).toEqual([
      "Panel.act",
    ]);
    const pageStateText = (await ayme.getPageState()).text;
    expect(pageStateText).not.toMatch(/Panel(?:\.|:)/);
    expect(pageStateText).not.toContain("Panel action");
  });

  it("excludes the inspector host without mutating capture styles", async () => {
    document.body.innerHTML = `
      <main><h1>Consumer application</h1></main>
      <div data-ayme-inspector-host><span>POM inspector controls</span></div>
    `;
    const host = document.querySelector(
      "[data-ayme-inspector-host]"
    ) as HTMLElement;
    host.style.display = "block";

    startRuntime();
    const context = await ayme.getPageContext();
    expect(context.structure).toContain("Consumer application");
    expect(context.structure).not.toContain("POM inspector controls");
    expect(host.style.getPropertyValue("display")).toBe("block");
  });
});

function structuralRefFor(
  text: string,
  accessibleName: string,
  role = "button"
) {
  const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(`(?:^|\\s)(e\\d+) ${role} "${escapedName}"`)
  )?.[1];
  return match ? AriaRefSchema.parse(match) : undefined;
}
