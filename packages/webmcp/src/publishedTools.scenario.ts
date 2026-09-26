/**
 * Browser-test scenario, shared by the native WebMCP and the polyfill runs:
 * the internal list of published tools is exactly what the runtime session
 * has published to WebMCP: every tool while publication is active, nothing
 * while it is disabled, failed or stopped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelContext, RegisteredTool } from "@mcp-b/webmcp-types";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PomManifest } from "./contracts";
import {
  getPublicationStatus,
  listPublishedTools,
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

type SessionOptions = Parameters<typeof createRuntimeSession>[0];

const highlight: RefTool = {
  name: "highlight",
  description: "Highlight an element.",
  execute: async () => undefined,
};

export function describePublishedTools(
  label: string,
  getContext: () => ModelContext
): void {
  describe(`the published tool list through ${label}`, () => {
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
        goalLoop: () => Promise.reject(new Error("The Goal Loop is not run.")),
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
    });

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
  });
}
