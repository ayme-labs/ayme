import { elementOfRef } from "../../test-utils/elementRefs.testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { ayme as model } from "../../page-objects/domain";
import {
  createPage,
  listAvailablePomTools,
  probeRegisteredPomMembers,
} from "../../page-objects/infrastructure";
import { registerCompiledPom } from "../../page-objects/application";
import { ayme } from "../../test-utils/agentCalls.testSupport";
import { agentTools } from "../../test-utils/publication.testSupport";
import { rootOf } from "../../test-utils/pomRoot.testSupport";
import { createAyme } from "../../runtime";
import { browserInPage } from "./browserInPage";
import {
  ToolInputError,
  type ElementFilter,
  type PomManifest,
  type ToolManifest,
} from "../../shared";

const action = (methodName: string, toolName = methodName): ToolManifest => ({
  methodName: methodName.split(".").at(-1)!,
  toolName,
  description: methodName,
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

describe("the ignore filter in page state capture", () => {
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

  function startRuntime(ignore?: ElementFilter) {
    const runtime = createAyme({ pageFactory: () => page, ignore });
    stop = runtime.start();
    return runtime;
  }

  it("drops ignored subtrees from snapshot and unresolved refs", async () => {
    document.body.innerHTML = `
      <main>
        <button id="save">Save changes</button>
        <aside id="assistant"><button id="help">Get help</button></aside>
      </main>
    `;
    startRuntime((session) => session.locator("#assistant"));

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
        node: { ref: saveRef },
      },
    ]);
    expect(await elementOfRef(saveRef)).toBe(document.querySelector("#save"));
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
    model({ root: rootOf })(Panel);
    registerCompiledPom(
      Panel,
      manifest("Panel", [root()], [action("act", "Panel.act")])
    );
    startRuntime((session) => session.locator("#assistant")).pom.register(
      Panel
    );

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
    model({ root: rootOf })(Panel);
    registerCompiledPom(
      Panel,
      manifest("Panel", [root()], [action("act", "Panel.act")])
    );
    startRuntime((session) => session.locator("#assistant")).pom.register(
      Panel
    );

    await probeRegisteredPomMembers();
    expect(listAvailablePomTools().map((tool) => tool.name)).toEqual([
      "Panel.act",
    ]);
    const pageStateText = (await ayme.getPageState()).text;
    expect(pageStateText).not.toMatch(/Panel(?:\.|:)/);
    expect(pageStateText).not.toContain("Panel action");
  });

  it("leaves out what a Locator matches by role and a name it reads from the code around it", async () => {
    document.body.innerHTML = `
      <main><button>Save changes</button></main>
      <aside aria-label="Assistant"><button>Get help</button></aside>
      <aside aria-label="Notes"><button>Read notes</button></aside>
    `;
    const assistant = "Assistant";
    startRuntime((session) =>
      session.getByRole("complementary", { name: assistant })
    );

    const { structure } = await ayme.getPageContext();
    expect(structure).toContain("Save changes");
    expect(structure).toContain("Read notes");
    expect(structure).not.toContain("Get help");
  });

  it("leaves out an element added after the session started, once the Locator matches it at the next capture", async () => {
    document.body.innerHTML = "<main><button>Save changes</button></main>";
    startRuntime((session) =>
      session.getByRole("complementary", { name: "Assistant" })
    );
    expect((await ayme.getPageContext()).structure).toContain("Save changes");

    document.body.insertAdjacentHTML(
      "beforeend",
      '<aside aria-label="Assistant"><button>Get help</button></aside>'
    );

    const { structure } = await ayme.getPageContext();
    expect(structure).toContain("Save changes");
    expect(structure).not.toContain("Get help");
  });

  it("leaves out of an action's own changes what the action adds and the Locator matches, so nothing shows as removed after", async () => {
    document.body.innerHTML = "<button>Notify</button><button>Other</button>";
    document.querySelector("button")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="status">Saved</div>'
      );
    });
    startRuntime((session) => session.getByRole("status"));
    const call = (name: string, input: unknown) =>
      agentTools().call(name, input);
    const { structure } = (await call("snapshot", {})) as {
      structure: string;
    };
    const refOf = (name: string) =>
      new RegExp(`- (e\\d+) button "${name}"`).exec(structure)![1]!;

    const clicked = (await call("click", { target: refOf("Notify") })) as {
      changes?: string;
    };
    const next = (await call("click", { target: refOf("Other") })) as {
      changes_before?: string;
    };

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Saved"
    );
    expect(clicked.changes ?? "").not.toContain("Saved");
    expect(next.changes_before).toBeUndefined();
    expect((await ayme.getPageContext()).structure).not.toContain("Saved");
  });

  it("leaves none of its Locator's matches in the document's module once the session stops", async () => {
    document.body.innerHTML = `
      <main><button>Save changes</button></main>
      <aside id="assistant"><button>Get help</button></aside>
    `;
    startRuntime((session) => session.locator("#assistant"));
    expect((await ayme.getPageContext()).structure).not.toContain("Get help");

    stop?.();
    stop = undefined;

    // The key the session handed the module the Locator's matches under.
    const capture = () =>
      browserInPage().capture({
        elements: { ignores: [{ matches: "ignore" }] },
      });
    await expect.poll(async () => (await capture()).excludedRefs).toEqual([]);
  });

  it("calls the function once, on start, with the session's Page", () => {
    const pages: unknown[] = [];
    const runtime = createAyme({
      pageFactory: () => page,
      ignore: (session) => {
        pages.push(session);
        return session.locator("#assistant");
      },
    });

    stop = runtime.start();

    expect(pages).toHaveLength(1);
    expect((pages[0] as typeof page).url()).toBe(page.url());
  });

  it("refuses to start when the function throws or returns no Locator, naming `ignore`", () => {
    const starting = (ignore: ElementFilter) => () =>
      createAyme({ pageFactory: () => page, ignore }).start();
    const threw = starting(() => {
      throw new Error("the panel is not mounted");
    });
    const gaveNone = starting((() => "#assistant") as never);

    expect(threw).toThrow(ToolInputError);
    expect(threw).toThrow(
      "The `ignore` function threw when the session started: the panel is not mounted"
    );
    expect(gaveNone).toThrow(ToolInputError);
    expect(gaveNone).toThrow("The `ignore` function did not return a Locator.");
    // Neither left an owner behind: a session that registers starts.
    expect(() => startRuntime("#assistant")).not.toThrow();
  });

  it("excludes a marked subtree without mutating capture styles", async () => {
    document.body.innerHTML = `
      <main><h1>Consumer application</h1></main>
      <div data-ayme-exclude><span>POM inspector controls</span></div>
    `;
    const host = document.querySelector("[data-ayme-exclude]") as HTMLElement;
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
