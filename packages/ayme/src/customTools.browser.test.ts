import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import { createPage } from "./browserPage";
import { createAyme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";
import type { CustomTool } from "./elementTools";
import { toolFailure } from "./toolFailure.testSupport";

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

describe("Custom Tools in Chromium", () => {
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

  /** Start a runtime session with the given Custom Tools and publish its tools. */
  async function publish(customTools?: CustomTool[]) {
    const runtime = createAyme({
      pageFactory: () => page,
      customTools,
    });
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
    const context = (await registrationOf(published, "snapshot").tool.execute(
      {}
    )) as { structure: string };
    return context.structure;
  }

  /** A Custom Tool that records the targets it received. */
  function recordingCustomTool(overrides: Partial<CustomTool> = {}) {
    const targets: { ref: string; element: Element }[] = [];
    const customTool: CustomTool = {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      execute: async (target) => {
        targets.push(target);
        return null;
      },
      ...overrides,
    };
    return { customTool, targets };
  }

  // --- Registration ---

  it("publishes a registered Custom Tool with its name, description and ref input", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool();

    const published = await publish([customTool]);

    const { tool } = registrationOf(published, "highlight_element");
    expect(tool.description).toBe("Highlight one element on the page.");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    });
  });

  it("rejects a Custom Tool whose name collides with another published tool", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool({ name: "click" });

    await expect(publish([customTool])).rejects.toThrow(
      'Cannot publish the tool "click": another published tool already uses that name.'
    );
  });

  // --- Execution ---

  it("passes the current Structural Ref and its element to execute", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool, targets } = recordingCustomTool();
    const published = await publish([customTool]);
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
    const { customTool, targets } = recordingCustomTool();
    const published = await publish([customTool]);
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
    const { customTool } = recordingCustomTool({
      execute: async () => ({ highlighted: true }),
    });
    const published = await publish([customTool]);
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

  it("reports what the Custom Tool changed on the page", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool({
      execute: async ({ element }) => {
        element.insertAdjacentHTML("afterend", "<p>Highlighted</p>");
        return null;
      },
    });
    const published = await publish([customTool]);
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
    const { customTool, targets } = recordingCustomTool({
      filter: () => false,
    });
    const published = await publish([customTool]);
    const saveRef = refFor(await structure(published), "Save changes");

    await registrationOf(published, "highlight_element").tool.execute({
      ref: saveRef,
    });

    expect(targets).toHaveLength(1);
  });

  // --- Ref resolution failures ---

  it("fails an unknown ref without calling execute", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool, targets } = recordingCustomTool();
    const published = await publish([customTool]);
    await structure(published);

    await expect(
      registrationOf(published, "highlight_element").tool.execute({
        ref: "e999",
      })
    ).resolves.toEqual(
      toolFailure(
        'RefResolutionError: Cannot run "highlight_element" on ref "e999": unknown-ref.'
      )
    );
    expect(targets).toHaveLength(0);
  });

  it("fails a removed ref without calling execute", async () => {
    document.body.innerHTML =
      '<button id="save">Save changes</button><p>Keep me</p>';
    const { customTool, targets } = recordingCustomTool();
    const published = await publish([customTool]);
    const saveRef = refFor(await structure(published), "Save changes");
    document.querySelector("#save")!.remove();

    await expect(
      registrationOf(published, "highlight_element").tool.execute({
        ref: saveRef,
      })
    ).resolves.toEqual(
      toolFailure(
        `RefResolutionError: Cannot run "highlight_element" on ref "${saveRef}": removed.`
      )
    );
    expect(targets).toHaveLength(0);
  });

  // --- Session lifetime ---

  it("unregisters a Custom Tool when the runtime session ends", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool();
    const published = await publish([customTool]);
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

function refFor(text: string, accessibleName: string, role = "button") {
  const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = text.match(
    new RegExp(`(?:^|\\s)(e\\d+) ${role} "${escapedName}"`)
  )?.[1];
  if (!ref) throw new Error(`Expected a Structural Ref for ${accessibleName}.`);
  return AriaRefSchema.parse(ref);
}
