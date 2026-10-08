import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import { createPage } from "./browserPage";
import { agentTools } from "./publication.testSupport";
import { listWebMcpTools } from "./publishedTools";
import { createAyme } from "./runtime";
import type { CustomTool } from "./elementTools";
import { toolFailure } from "./toolFailure.testSupport";

type ActionResultShape = {
  result?: unknown;
  page_changed: boolean;
  settled: boolean;
  changes?: string;
};

describe("Custom Tools in Chromium", () => {
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

  /** Start a runtime session with the given Custom Tools. */
  function start(customTools?: CustomTool[]) {
    const runtime = createAyme({
      pageFactory: () => page,
      customTools,
    });
    stop = runtime.start();
  }

  const call = (name: string, input: unknown) => agentTools().call(name, input);

  async function structure(): Promise<string> {
    const context = (await call("snapshot", {})) as { structure: string };
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

  it("publishes a registered Custom Tool with its name, description and ref input", () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool();

    start([customTool]);

    const tool = listWebMcpTools().find(
      ({ name }) => name === "highlight_element"
    );
    expect(tool?.description).toBe("Highlight one element on the page.");
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    });
  });

  it("rejects a Custom Tool whose name collides with another published tool", () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool({ name: "click" });

    start([customTool]);

    expect(() => agentTools().names()).toThrow(
      'Cannot publish the tool "click": another published tool already uses that name.'
    );
  });

  // --- Execution ---

  it("passes the current Structural Ref and its element to execute", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool, targets } = recordingCustomTool();
    start([customTool]);
    const saveRef = refFor(await structure(), "Save changes");

    await call("highlight_element", { ref: saveRef });

    expect(targets).toEqual([
      { ref: saveRef, element: document.querySelector("#save") },
    ]);
  });

  it("retargets a historical ref to the element that replaced it", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool, targets } = recordingCustomTool();
    start([customTool]);
    const saveRef = refFor(await structure(), "Save changes");

    const replacement = document.createElement("button");
    replacement.id = "save";
    replacement.textContent = "Save changes";
    document.querySelector("#save")!.replaceWith(replacement);

    await call("highlight_element", { ref: saveRef });

    expect(targets).toHaveLength(1);
    expect(targets[0]!.element).toBe(replacement);
  });

  it("returns the action result shape with a JSON value under result", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool({
      execute: async () => ({ highlighted: true }),
    });
    start([customTool]);
    const saveRef = refFor(await structure(), "Save changes");

    const result = (await call("highlight_element", {
      ref: saveRef,
    })) as ActionResultShape;

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
    start([customTool]);
    const saveRef = refFor(await structure(), "Save changes");

    const result = (await call("highlight_element", {
      ref: saveRef,
    })) as ActionResultShape;

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Highlighted");
  });

  it("does not enforce the filter when the calling agent calls the tool", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool, targets } = recordingCustomTool({
      filter: () => false,
    });
    start([customTool]);
    const saveRef = refFor(await structure(), "Save changes");

    await call("highlight_element", { ref: saveRef });

    expect(targets).toHaveLength(1);
  });

  // --- Ref resolution failures ---

  it("fails an unknown ref without calling execute", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool, targets } = recordingCustomTool();
    start([customTool]);
    await structure();

    await expect(call("highlight_element", { ref: "e999" })).resolves.toEqual(
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
    start([customTool]);
    const saveRef = refFor(await structure(), "Save changes");
    document.querySelector("#save")!.remove();

    await expect(call("highlight_element", { ref: saveRef })).resolves.toEqual(
      toolFailure(
        `RefResolutionError: Cannot run "highlight_element" on ref "${saveRef}": removed.`
      )
    );
    expect(targets).toHaveLength(0);
  });

  // --- Session lifetime ---

  it("unregisters a Custom Tool when the runtime session ends", () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const { customTool } = recordingCustomTool();
    start([customTool]);
    expect(agentTools().names()).toContain("highlight_element");

    stop?.();
    stop = undefined;
    expect(listWebMcpTools().map(({ name }) => name)).not.toContain(
      "highlight_element"
    );
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
