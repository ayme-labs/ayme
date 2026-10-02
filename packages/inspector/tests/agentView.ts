import type { Page } from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
} from "@ayme-dev/ayme/testing";

/** A tool as an agent gets it over WebMCP. */
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

/**
 * What an agent gets over the page's WebMCP: the published tools, and
 * get_page_context's result, as the recording WebMCP driver received them.
 * The e2e tests take their expected values from here, never from the panel.
 */
export class AgentView {
  constructor(private readonly page: Page) {}

  /** The tools published to WebMCP, in publication order. */
  async tools(): Promise<AgentTool[]> {
    const names = await publishedToolNames(this.page);
    if (names.length === 0)
      throw new Error("The page publishes no tools to WebMCP.");
    const tools: AgentTool[] = [];
    for (const name of names) {
      const tool = await publishedToolSchema(this.page, name);
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
  call(name: string, input: object): Promise<unknown> {
    return executePublishedTool(this.page, name, input);
  }

  /** The Page Object definitions get_page_context returns for these models. */
  async pomDefinitions(...names: string[]): Promise<string> {
    const { pomDefinitions } = (await this.call("get_page_context", {
      names,
    })) as { pomDefinitions: string };
    return pomDefinitions;
  }
}
