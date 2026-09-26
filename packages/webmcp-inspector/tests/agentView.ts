import type { Page } from "@playwright/test";

/** A tool as an agent gets it over WebMCP. */
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

/**
 * What an agent gets over the page's WebMCP: the published tools, and
 * get_page_context's result. The e2e tests take their expected values from
 * here, never from the panel.
 */
export class AgentView {
  constructor(private readonly page: Page) {}

  /** The tools published to WebMCP, as `getTools()` lists them. */
  async tools(): Promise<AgentTool[]> {
    const tools = await this.page.evaluate(async () => {
      const context = document.modelContext as unknown as {
        getTools(): Promise<
          { name: string; description: string; inputSchema: unknown }[]
        >;
      };
      return (await context.getTools()).map(
        ({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema:
            typeof inputSchema === "string"
              ? (JSON.parse(inputSchema) as unknown)
              : inputSchema,
        })
      );
    });
    if (tools.length === 0)
      throw new Error("The page publishes no tools to WebMCP.");
    return tools;
  }

  /** Calls a published tool the way an agent does and parses its result. */
  async call(name: string, input: unknown): Promise<unknown> {
    return this.page.evaluate(
      async ({ name, input }) => {
        const context = document.modelContext as unknown as {
          getTools(): Promise<{ name: string }[]>;
          executeTool(tool: unknown, input: string): Promise<string | null>;
        };
        const tool = (await context.getTools()).find(
          (candidate) => candidate.name === name
        );
        if (!tool) throw new Error(`${name} is not published.`);
        const result = await context.executeTool(tool, JSON.stringify(input));
        return JSON.parse(result ?? "null") as unknown;
      },
      { name, input }
    );
  }

  /** The Page Object definitions get_page_context returns for these models. */
  async pomDefinitions(...names: string[]): Promise<string> {
    const { pomDefinitions } = (await this.call("get_page_context", {
      names,
    })) as { pomDefinitions: string };
    return pomDefinitions;
  }
}
