import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import { createPage } from "./browserPage";
import { createRuntimeSession } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";
import {
  isClickableElement,
  isFillableElement,
  type RefTool,
} from "./refTools";

type PublishedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  execute(input: unknown): Promise<unknown>;
};

type Registration = { tool: PublishedTool; signal: AbortSignal };

type ActionResultShape = {
  result?: unknown;
  page_changed: boolean;
  settled: boolean;
  changes?: string;
};

function createFakeDriver() {
  const published = new Map<string, Registration>();
  const driver = {
    async registerTool(tool: PublishedTool, options: { signal: AbortSignal }) {
      published.set(tool.name, { tool, signal: options.signal });
    },
  };
  return { driver, published };
}

describe("Ref Tools in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let stop: (() => void) | undefined;
  let disposePublication: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
  });

  afterEach(() => {
    disposePublication?.();
    disposePublication = undefined;
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  /** Start a runtime session with the given Ref Tools and publish its tools. */
  async function publish(refTools?: RefTool[]) {
    const runtime = createRuntimeSession(page, refTools ? { refTools } : {});
    stop = runtime.start();
    return republish();
  }

  async function republish() {
    const { driver, published } = createFakeDriver();
    const publication = await synchronizeWebMcpTools(driver);
    disposePublication = publication.dispose;
    return published;
  }

  function registrationOf(
    published: Map<string, Registration>,
    name: string
  ): Registration {
    const registration = published.get(name);
    if (!registration) throw new Error(`Tool ${name} was not published.`);
    return registration;
  }

  async function structure(
    published: Map<string, Registration>
  ): Promise<string> {
    const context = (await registrationOf(
      published,
      "get_page_context"
    ).tool.execute({})) as { structure: string };
    return context.structure;
  }

  /** A Ref Tool that records the targets it received. */
  function recordingRefTool(overrides: Partial<RefTool> = {}) {
    const targets: { ref: string; element: Element }[] = [];
    const refTool: RefTool = {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      execute: async (target) => {
        targets.push(target);
        return null;
      },
      ...overrides,
    };
    return { refTool, targets };
  }

  // --- Registration ---

  it("publishes a registered Ref Tool with its name, description and ref input", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool } = recordingRefTool();

    const published = await publish([refTool]);

    const { tool } = registrationOf(published, "highlight_element");
    expect(tool.description).toBe("Highlight one element on the page.");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    });
  });

  it("keeps click and fill published with their names and inputs", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';

    const published = await publish();

    expect(
      registrationOf(published, "click_page_state_ref").tool.inputSchema
    ).toEqual({
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    });
    expect(
      registrationOf(published, "fill_page_state_ref").tool.inputSchema
    ).toEqual({
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
      additionalProperties: false,
    });
  });

  it("rejects a Ref Tool whose name collides with another published tool", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool } = recordingRefTool({ name: "click_page_state_ref" });

    await expect(publish([refTool])).rejects.toThrow(
      'Cannot publish the Ref Tool "click_page_state_ref": another published tool already uses that name.'
    );
  });

  // --- Execution ---

  it("passes the current Structural Ref and its element to execute", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool, targets } = recordingRefTool();
    const published = await publish([refTool]);
    const saveRef = refFor(await structure(published), "Save changes");

    await registrationOf(published, "highlight_element").tool.execute({
      ref: saveRef,
    });

    expect(targets).toEqual([
      { ref: saveRef, element: document.querySelector("#save") },
    ]);
  });

  it("retargets a historical ref to the element that replaced it", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool, targets } = recordingRefTool();
    const published = await publish([refTool]);
    const saveRef = refFor(await structure(published), "Save changes");

    const replacement = document.createElement("button");
    replacement.id = "save";
    replacement.textContent = "Save changes";
    document.querySelector("#save")!.replaceWith(replacement);

    await registrationOf(published, "highlight_element").tool.execute({
      ref: saveRef,
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]!.element).toBe(replacement);
  });

  it("returns the action result shape with a JSON value under result", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool } = recordingRefTool({
      execute: async () => ({ highlighted: true }),
    });
    const published = await publish([refTool]);
    const saveRef = refFor(await structure(published), "Save changes");

    const result = (await registrationOf(
      published,
      "highlight_element"
    ).tool.execute({ ref: saveRef })) as ActionResultShape;

    expect(result).toEqual({
      result: { highlighted: true },
      page_changed: false,
      settled: true,
    });
  });

  it("reports what the Ref Tool changed on the page", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool } = recordingRefTool({
      execute: async ({ element }) => {
        element.insertAdjacentHTML("afterend", "<p>Highlighted</p>");
        return null;
      },
    });
    const published = await publish([refTool]);
    const saveRef = refFor(await structure(published), "Save changes");

    const result = (await registrationOf(
      published,
      "highlight_element"
    ).tool.execute({ ref: saveRef })) as ActionResultShape;

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Highlighted");
  });

  it("does not enforce the filter when the calling agent calls the tool", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool, targets } = recordingRefTool({ filter: () => false });
    const published = await publish([refTool]);
    const saveRef = refFor(await structure(published), "Save changes");

    await registrationOf(published, "highlight_element").tool.execute({
      ref: saveRef,
    });

    expect(targets).toHaveLength(1);
  });

  // --- Ref resolution failures ---

  it("fails an unknown ref without calling execute", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool, targets } = recordingRefTool();
    const published = await publish([refTool]);
    await structure(published);

    await expect(
      registrationOf(published, "highlight_element").tool.execute({
        ref: "e999",
      })
    ).rejects.toThrow(
      'Cannot run "highlight_element" on ref "e999": unknown-ref.'
    );
    expect(targets).toHaveLength(0);
  });

  it("fails a removed ref without calling execute", async () => {
    document.body.innerHTML =
      '<button id="save">Save changes</button><p>Keep me</p>';
    const { refTool, targets } = recordingRefTool();
    const published = await publish([refTool]);
    const saveRef = refFor(await structure(published), "Save changes");
    document.querySelector("#save")!.remove();

    await expect(
      registrationOf(published, "highlight_element").tool.execute({
        ref: saveRef,
      })
    ).rejects.toThrow(
      `Cannot run "highlight_element" on ref "${saveRef}": removed.`
    );
    expect(targets).toHaveLength(0);
  });

  // --- Session lifetime ---

  it("unregisters a Ref Tool when the runtime session ends", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { refTool } = recordingRefTool();
    const published = await publish([refTool]);
    const registration = registrationOf(published, "highlight_element");
    expect(registration.signal.aborted).toBe(false);

    // A session disposes the publication it owns when it stops; this test owns
    // the publication, so it disposes it in the session's place.
    disposePublication?.();
    disposePublication = undefined;
    expect(registration.signal.aborted).toBe(true);

    stop?.();
    stop = undefined;
    const afterSession = await republish();
    expect([...afterSession.keys()]).not.toContain("highlight_element");
  });
});

// --- Built-in filters (consumed by the Goal Loop when it offers elements) ---

describe("built-in Ref Tool filters in Chromium", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function fixture(html: string): Element {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild;
    if (!element) throw new Error("Expected a fixture element.");
    return element;
  }

  it("keeps elements with an interactive role for click", () => {
    expect(isClickableElement(fixture("<button>Save</button>"))).toBe(true);
    expect(isClickableElement(fixture('<a href="/next">Next</a>'))).toBe(true);
    expect(isClickableElement(fixture('<div role="button">Go</div>'))).toBe(
      true
    );
  });

  it("keeps elements with a pointer cursor for click", () => {
    expect(
      isClickableElement(fixture('<div style="cursor: pointer">Card</div>'))
    ).toBe(true);
  });

  it("drops plain and disabled elements for click", () => {
    expect(isClickableElement(fixture("<p>Just text</p>"))).toBe(false);
    expect(isClickableElement(fixture("<button disabled>Save</button>"))).toBe(
      false
    );
    expect(
      isClickableElement(fixture('<button aria-disabled="true">Save</button>'))
    ).toBe(false);
    expect(
      isClickableElement(
        fixture('<a role="button" style="cursor: pointer">No href</a>')
      )
    ).toBe(true);
  });

  it("keeps elements that can actually be filled", () => {
    expect(isFillableElement(fixture('<input aria-label="Name">'))).toBe(true);
    expect(
      isFillableElement(fixture('<input type="email" aria-label="Mail">'))
    ).toBe(true);
    expect(isFillableElement(fixture('<textarea aria-label="Note">'))).toBe(
      true
    );
    expect(
      isFillableElement(fixture('<div contenteditable="true">Text</div>'))
    ).toBe(true);
  });

  it("drops elements that cannot be filled", () => {
    expect(isFillableElement(fixture("<button>Save</button>"))).toBe(false);
    expect(
      isFillableElement(fixture('<input type="checkbox" aria-label="Done">'))
    ).toBe(false);
    expect(
      isFillableElement(fixture('<input readonly aria-label="Name">'))
    ).toBe(false);
    expect(
      isFillableElement(fixture('<input disabled aria-label="Name">'))
    ).toBe(false);
  });
});

function refFor(text: string, accessibleName: string, role = "button") {
  const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = text.match(
    new RegExp(`(?:^|\\s)(e\\d+) ${role} "${escapedName}"`)
  )?.[1];
  if (!ref) throw new Error(`Expected a Structural Ref for ${accessibleName}.`);
  return AriaRefSchema.parse(ref);
}
