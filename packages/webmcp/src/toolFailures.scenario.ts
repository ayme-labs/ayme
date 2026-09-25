/**
 * Browser-test scenario, shared by the native WebMCP and the polyfill runs:
 * failing Ayme tools called through `document.modelContext.executeTool`
 * resolve with an MCP `isError` result instead of a bare `UnknownError`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ChromeModelContextExtensions,
  ModelContext,
} from "@mcp-b/webmcp-types";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PomManifest } from "./contracts";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createRuntimeSession } from "./runtime";
import { synchronizeWebMcpTools, type WebMcpDriver } from "./webMcp";
import { toolFailure } from "./toolFailure.testSupport";

type Context = ModelContext & ChromeModelContextExtensions;

const failingManifest: PomManifest = {
  className: "FailingPage",
  members: [],
  tools: [
    {
      methodName: "explode",
      toolName: "FailingPage.explode",
      description: "Always fails.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
  components: [],
};

class FailingPage {
  explode() {
    throw new Error("The page object action exploded.");
  }
}

export function describeToolFailures(
  label: string,
  getContext: () => Context
): void {
  describe(`published tool failures through ${label}`, () => {
    let context: Context;
    const cleanups: (() => void)[] = [];

    beforeEach(async () => {
      context = getContext();
      document.body.innerHTML = `
        <button id="save">Save changes</button>
        <div style="position: fixed; inset: 0"></div>
      `;
      const runtime = createRuntimeSession({
        page: () => createPage({ actionTimeout: 1000 }),
      });
      cleanups.push(runtime.start());
      registerCompiledPom(FailingPage, failingManifest);
      cleanups.push(createPageRegistration(FailingPage).dispose);
      const publication = await synchronizeWebMcpTools(context as WebMcpDriver);
      cleanups.push(publication.dispose);
    });

    afterEach(() => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      document.body.innerHTML = "";
    });

    /** `executeTool` as a WebMCP caller sees it: the result's JSON string. */
    async function callTool(name: string, input: unknown) {
      const tool = (await context.getTools()).find(
        (candidate) => candidate.name === name
      );
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      return context.executeTool!(tool, JSON.stringify(input));
    }

    async function executeTool(name: string, input: unknown) {
      return JSON.parse((await callTool(name, input)) ?? "null") as unknown;
    }

    async function saveRef() {
      const { structure } = (await executeTool("get_page_context", {})) as {
        structure: string;
      };
      const ref = structure.match(/(e\d+) button "Save changes"/)?.[1];
      if (!ref) throw new Error("Expected a Structural Ref for Save changes.");
      return AriaRefSchema.parse(ref);
    }

    /** The contract: an MCP `isError` result carrying `text`. */
    function expectFailureResult(result: unknown, text: unknown) {
      expect(result).toEqual(toolFailure(text));
    }

    it("returns a browser action failure with its name and call log", async () => {
      const ref = await saveRef();

      const call = callTool("click_page_state_ref", { ref });

      await expect(call).resolves.toBeTypeOf("string");
      expectFailureResult(
        JSON.parse((await call)!),
        expect.stringMatching(
          /^TimeoutError: page\.click: Timeout 1000ms[\s\S]*Call log:/
        )
      );
    });

    it("returns a ref that no longer matches as a RefResolutionError", async () => {
      const ref = await saveRef();
      document.querySelector("#save")!.remove();

      expectFailureResult(
        await executeTool("click_page_state_ref", { ref }),
        `RefResolutionError: Cannot click ref "${ref}": removed.`
      );
    });

    it("returns a throwing Page Object tool's message", async () => {
      expectFailureResult(
        await executeTool("FailingPage.explode", {}),
        "The page object action exploded."
      );
    });

    it("returns invalid get_page_context input as a ToolInputError", async () => {
      expectFailureResult(
        await executeTool("get_page_context", { names: "x" }),
        expect.stringMatching(/^ToolInputError: .*names/)
      );
    });
  });
}
