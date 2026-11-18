import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
} from "@ayme-dev/e2e-testing";
import type { JsonValue } from "e2e";

import type { Tab } from "./tab";

// The e2e counterpart of `../agentView.ts`.

/** A tool as an agent gets it over WebMCP. */
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  /** Only on a tool marked destructive. */
  annotations?: { consequentialHint?: boolean };
};

/**
 * A tool's description as the panel shows it: what Ayme MCP gives agents.
 * WebMCP requires a description, so it gives a bare action `Run <action>.`,
 * which Ayme MCP and the panel leave out.
 */
export function panelDescription(tool: AgentTool): string {
  return tool.description === `Run ${tool.name.split(".").at(-1)}.`
    ? ""
    : tool.description;
}

/**
 * What an agent gets over the page's WebMCP: the published tools, and
 * snapshot's result, as the recording WebMCP driver received them. The e2e
 * tests take their expected values from here, never from the panel. It reads
 * the fixture page's tab, which it brings to the front.
 */
export class AgentView {
  constructor(private readonly page: Tab) {}

  /** The tools published to WebMCP, in publication order. */
  async tools(): Promise<AgentTool[]> {
    await this.page.front();
    const { browser } = this.page;
    const names = await publishedToolNames(browser);
    if (names.length === 0)
      throw new Error("The page publishes no tools to WebMCP.");
    const tools: AgentTool[] = [];
    for (const name of names) {
      const tool = (await publishedToolSchema(
        browser,
        name
      )) as AgentTool | null;
      if (!tool) throw new Error(`${name} stopped being published.`);
      tools.push({
        ...tool,
        inputSchema:
          typeof tool.inputSchema === "string"
            ? (JSON.parse(tool.inputSchema) as unknown)
            : tool.inputSchema,
      });
    }
    return tools;
  }

  /** Calls a published tool the way an agent does. */
  async call(
    name: string,
    input: { [key: string]: JsonValue }
  ): Promise<unknown> {
    await this.page.front();
    return executePublishedTool(this.page.browser, name, input);
  }

  /**
   * The ref snapshot gives the node on this structure line, such as
   * `button "Add item"`.
   */
  async ref(line: string): Promise<string> {
    const { structure } = (await this.call("snapshot", {})) as {
      structure: string;
    };
    const ref = structure.match(new RegExp(`(e\\d+) ${line}`))?.[1];
    if (!ref) throw new Error(`No ${line} in:\n${structure}`);
    return ref;
  }

  /** The Page Object definitions snapshot returns for these models. */
  async pomDefinitions(...names: string[]): Promise<string> {
    const { pomDefinitions } = (await this.call("snapshot", {
      names,
    })) as { pomDefinitions: string };
    return pomDefinitions;
  }
}
