/**
 * Browser-test scenario, shared by the native WebMCP and the polyfill runs:
 * the internal list of published tools is exactly what the runtime session
 * has published to WebMCP: every tool while publication is active, nothing
 * while it is disabled, failed or stopped. Running a published tool from the
 * internal entry returns what an agent gets for the same call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChromeModelContextExtensions,
  ModelContext as WebMcpModelContext,
  RegisteredTool,
} from "@mcp-b/webmcp-types";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PomManifest } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import {
  getPublicationStatus,
  listPublishedTools,
  runPublishedTool,
  subscribeToPublishedTools,
  type PublishedToolGroup,
} from "./publishedTools";
import type { RefTool } from "./refTools";
import { registerCompiledPom } from "./registry";
import { createRuntimeSession, type RuntimeSession } from "./runtime";

// --- Fixtures: one tool of each kind an agent can be given ---

const pomManifest = (className: string, methodName: string): PomManifest => ({
  className,
  members: [],
  tools: [
    {
      methodName,
      toolName: `${className}.${methodName}`,
      description: `${methodName} on ${className}.`,
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
      parameters: [
        { name: "title", optional: false, schema: { type: "string" } },
      ],
    },
  ],
  components: [],
});

class TodoPage {
  addTodo() {}
}

class SettingsPage {
  save() {}
}

registerCompiledPom(TodoPage, pomManifest("TodoPage", "addTodo"));
registerCompiledPom(SettingsPage, pomManifest("SettingsPage", "save"));

/** Every tool the fixture session publishes, in the group the Inspector shows it under. */
const EXPECTED_GROUPS: Record<string, PublishedToolGroup> = {
  get_page_context: "agent",
  pursue_goal: "agent",
  click_page_state_ref: "ref",
  fill_page_state_ref: "ref",
  highlight: "ref",
  "TodoPage.addTodo": "pageObject",
};

// --- Mechanics ---

/** A tool as an agent reads it from WebMCP: name, description and schema. */
function asAgentSees(tool: RegisteredTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema:
      typeof tool.inputSchema === "string"
        ? (JSON.parse(tool.inputSchema) as unknown)
        : tool.inputSchema,
  };
}

async function publishedOverWebMcp(context: ModelContext) {
  return (await context.getTools()).map(asAgentSees).sort(byName);
}

function listed() {
  return listPublishedTools()
    .map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
    .sort(byName);
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

type ModelContext = WebMcpModelContext & ChromeModelContextExtensions;
type SessionOptions = Parameters<typeof createRuntimeSession>[0];

/** A stubbed System One model: no operation fits, so the loop hands over. */
async function noFittingOperation(
  request: DecisionRequest
): Promise<DecisionResponse> {
  const criteria = (
    request.questions as Record<string, { criteria?: Record<string, string> }>
  ).operation!.criteria!;
  return {
    model: request.model,
    answers: {
      operation: {
        type: "choice",
        choice: "none",
        confidence: 1,
        probabilities: Object.fromEntries(
          Object.keys(criteria).map((key) => [key, key === "none" ? 1 : 0])
        ),
      },
      goal_met: { type: "noul", noul: 0.1 },
    },
  };
}

const highlight: RefTool = {
  name: "highlight",
  description: "Highlight an element.",
  execute: async () => undefined,
};

export function describePublishedTools(
  label: string,
  getContext: () => ModelContext
): void {
  describe(`published tools through ${label}`, () => {
    let context: ModelContext;
    let runtime: RuntimeSession;
    const cleanups: (() => void)[] = [];

    /**
     * Start a runtime session with TodoPage registered, the way the framework
     * plugins do, and wait until its publication settles.
     */
    async function startSession({
      publish = true,
      ...options
    }: SessionOptions & { publish?: boolean } = {}) {
      vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", publish);
      runtime = createRuntimeSession({
        page: () => createPage({ actionTimeout: 1000 }),
        refTools: [highlight],
        goalLoop: noFittingOperation,
        ...options,
      });
      cleanups.push(runtime.register(TodoPage, runtime.construct(TodoPage)));
      const stop = runtime.start();
      cleanups.push(stop);
      await expect.poll(() => runtime.getSnapshot().state).not.toBe("waiting");
      // Diagnostic: a session meant to publish reached WebMCP, or failed for
      // the reason its test gives, before the Contract runs.
      if (publish && !options.refTools)
        expect(runtime.getSnapshot().state).toBe("active");
      return stop;
    }

    beforeEach(() => {
      context = getContext();
    });

    afterEach(() => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      vi.unstubAllGlobals();
      document.body.innerHTML = "";
    });

    /** What an agent gets back from WebMCP for this call. */
    async function agentGets(name: string, input: unknown) {
      const tool = (await context.getTools()).find(
        (candidate) => candidate.name === name
      );
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      return JSON.parse(
        (await context.executeTool!(tool, JSON.stringify(input))) ?? "null"
      ) as unknown;
    }

    async function saveButtonRef() {
      const { structure } = (await agentGets("get_page_context", {})) as {
        structure: string;
      };
      const ref = structure.match(/(e\d+) button "Save changes"/)?.[1];
      if (!ref) throw new Error("Expected a Structural Ref for Save changes.");
      return AriaRefSchema.parse(ref);
    }

    it("lists each published tool with the name, description and input schema WebMCP publishes", async () => {
      await startSession();

      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });

    it("puts each published tool in its group", async () => {
      await startSession();

      expect(
        Object.fromEntries(
          listPublishedTools().map(({ name, group }) => [name, group])
        )
      ).toEqual(EXPECTED_GROUPS);
    });

    it("tells subscribers when the published set changes, and lists the new set", async () => {
      await startSession();
      let notified = false;
      cleanups.push(
        subscribeToPublishedTools(() => {
          notified = true;
        })
      );

      cleanups.push(
        runtime.register(SettingsPage, runtime.construct(SettingsPage))
      );
      await expect
        .poll(() => listPublishedTools().map(({ name }) => name))
        .toContain("SettingsPage.save");

      expect(notified).toBe(true);
      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });

    it("lists nothing while publication is disabled", async () => {
      await startSession({ publish: false });

      expect(getPublicationStatus().state).toBe("disabled");
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("lists nothing, and reports the error, when publication fails on a name clash", async () => {
      await startSession({
        refTools: [{ ...highlight, name: "TodoPage.addTodo" }],
      });

      expect(getPublicationStatus()).toEqual({
        state: "failed",
        message: expect.stringContaining(
          'Cannot publish the Ref Tool "TodoPage.addTodo"'
        ),
      });
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("lists nothing once the session stops", async () => {
      const stop = await startSession();
      const heard: string[] = [];
      cleanups.push(
        subscribeToPublishedTools(() => {
          heard.push(getPublicationStatus().state);
        })
      );

      stop();

      expect(heard.at(-1)).toBe("disposed");
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it.each([
      ["a Page Object tool", "TodoPage.addTodo", () => ({ title: "Milk" })],
      [
        "the built-in click Ref tool",
        "click_page_state_ref",
        (ref: string) => ({ ref }),
      ],
      ["an app-registered Ref tool", "highlight", (ref: string) => ({ ref })],
      ["get_page_context", "get_page_context", () => ({})],
      [
        "pursue_goal",
        "pursue_goal",
        () => ({ goal: "Save the changes", maxSteps: 1 }),
      ],
    ])(
      "runs %s and returns what an agent gets for the same call",
      async (_kind, name, inputFor) => {
        document.body.innerHTML = `<button>Save changes</button>`;
        await startSession();
        const input = inputFor(await saveButtonRef());
        // A click focuses the button, so it is focused before the first call
        // too. Both calls then start from the same page, already seen.
        document.querySelector("button")!.focus();
        await agentGets("get_page_context", {});
        const expected = await agentGets(name, input);
        // Diagnostic: the call itself succeeds for an agent.
        expect(expected).not.toMatchObject({ isError: true });
        await agentGets("get_page_context", {});

        expect(await runPublishedTool(name, input)).toEqual(expected);
      }
    );

    it("returns a failing call's error result as an agent gets it", async () => {
      document.body.innerHTML = `<button id="save">Save changes</button>`;
      await startSession();
      const ref = await saveButtonRef();
      document.querySelector("#save")!.remove();
      const expected = await agentGets("click_page_state_ref", { ref });

      expect(await runPublishedTool("click_page_state_ref", { ref })).toEqual(
        expected
      );
      expect(expected).toMatchObject({ isError: true });
    });

    it("refuses to run a tool that is not published", async () => {
      await startSession();

      await expect(
        runPublishedTool("SettingsPage.save", { title: "x" })
      ).rejects.toThrow('The tool "SettingsPage.save" is not published.');
    });
  });
}
