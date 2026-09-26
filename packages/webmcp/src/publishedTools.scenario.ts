/**
 * Browser-test scenario, shared by the native WebMCP and the polyfill runs:
 * the internal list of published tools is exactly what WebMCP publishes, and
 * it follows changes to the published set.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelContext, RegisteredTool } from "@mcp-b/webmcp-types";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PomManifest } from "./contracts";
import {
  listPublishedTools,
  subscribeToPublishedTools,
  type PublishedToolGroup,
} from "./publishedTools";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createRuntimeSession } from "./runtime";
import { synchronizeWebMcpTools, type WebMcpDriver } from "./webMcp";

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

export function describePublishedTools(
  label: string,
  getContext: () => ModelContext
): void {
  describe(`the published tool list through ${label}`, () => {
    let context: ModelContext;
    const cleanups: (() => void)[] = [];

    beforeEach(async () => {
      context = getContext();
      const runtime = createRuntimeSession({
        page: () => createPage({ actionTimeout: 1000 }),
        refTools: [
          {
            name: "highlight",
            description: "Highlight an element.",
            execute: async () => undefined,
          },
        ],
        goalLoop: () => Promise.reject(new Error("The Goal Loop is not run.")),
      });
      cleanups.push(runtime.start());
      cleanups.push(createPageRegistration(TodoPage).dispose);
      const publication = await synchronizeWebMcpTools(context as WebMcpDriver);
      cleanups.push(publication.dispose);
      // Diagnostic: the fixture reached WebMCP before the Contract runs.
      expect((await context.getTools()).map((tool) => tool.name)).toContain(
        "TodoPage.addTodo"
      );
    });

    afterEach(() => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    });

    it("lists each published tool with the name, description and input schema WebMCP publishes", async () => {
      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });

    it("puts each published tool in its group", () => {
      expect(
        Object.fromEntries(
          listPublishedTools().map(({ name, group }) => [name, group])
        )
      ).toEqual(EXPECTED_GROUPS);
    });

    it("tells subscribers when the published set changes, and lists the new set", async () => {
      let notified = false;
      cleanups.push(
        subscribeToPublishedTools(() => {
          notified = true;
        })
      );

      cleanups.push(createPageRegistration(SettingsPage).dispose);
      await expect
        .poll(async () => (await context.getTools()).map((tool) => tool.name))
        .toContain("SettingsPage.save");

      expect(notified).toBe(true);
      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });
  });
}
