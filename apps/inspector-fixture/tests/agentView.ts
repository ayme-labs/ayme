import type { Page } from "@playwright/test";
import { SERVER_TOOLS, type Agent } from "@ayme-dev/mcp/testing";
import { executePublishedTool } from "@ayme-dev/webmcp/testing";

/** The Ayme MCP server each fixture page is connected to, set when it opens. */
export const pairedAgents = new WeakMap<Page, Agent>();

/** A tool as a coding agent gets it from the page's Ayme MCP server. */
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

/** A tool's description as the panel shows it: what Ayme MCP gives agents. */
export function panelDescription(tool: AgentTool): string {
  return tool.description;
}

/**
 * What an agent gets from the page: its tools and `snapshot` from the page's
 * `ayme mcp --browser-tools` server, and Page Object Tools over its WebMCP,
 * as the recording WebMCP driver received them. WebMCP publishes only the
 * Page Object Tools and `page_objects`. The e2e tests take their expected
 * values from here, never from the panel.
 */
export class AgentView {
  constructor(private readonly page: Page) {}

  private get agent(): Agent {
    const agent = pairedAgents.get(this.page);
    if (!agent) throw new Error("The page is not connected to an agent.");
    return agent;
  }

  /** The page's tools as its Ayme MCP server lists them. */
  async tools(): Promise<AgentTool[]> {
    const { tools } = await this.agent.client.listTools();
    return tools
      .filter(({ name }) => !SERVER_TOOLS.includes(name))
      .map(({ name, description, inputSchema }) => ({
        name,
        description: description ?? "",
        inputSchema,
      }));
  }

  /**
   * Runs a tool through the Ayme MCP server, as a coding agent does, and
   * returns its text as JSON when it is.
   */
  async run(
    name: string,
    input: Record<string, unknown> = {}
  ): Promise<unknown> {
    const { text, isError } = await this.agent.call(name, input);
    if (isError) throw new Error(`${name} failed: ${text}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  /** Calls a published tool the way an agent does. */
  call(name: string, input: object): Promise<unknown> {
    return executePublishedTool(this.page, name, input);
  }

  /**
   * The ref snapshot gives the node on this structure line, such as
   * `button "Add item"`.
   */
  async ref(line: string): Promise<string> {
    const { structure } = (await this.run("snapshot", {})) as {
      structure: string;
    };
    const ref = structure.match(new RegExp(`(e\\d+) ${line}`))?.[1];
    if (!ref) throw new Error(`No ${line} in:\n${structure}`);
    return ref;
  }

  /**
   * The Page Object id snapshot gives the Page Object Root of this class,
   * such as `Navigator`, whether the root is marked with the class alone or
   * lists it among several.
   */
  async id(className: string): Promise<string> {
    const { structure } = (await this.run("snapshot", {})) as {
      structure: string;
    };
    const id = (structure.match(new RegExp(`e\\d+ ${className} (po\\d+)`)) ??
      structure.match(
        new RegExp(
          `/pom: \\[[^\\]]*"${className}"[^\\]]*\\]\\s+- /id: (po\\d+)`
        )
      ))?.[1];
    if (!id) throw new Error(`No ${className} in:\n${structure}`);
    return id;
  }

  /** The Page Object definitions snapshot returns for these models. */
  async pomDefinitions(...names: string[]): Promise<string> {
    const { pomDefinitions } = (await this.run("snapshot", {
      names,
    })) as { pomDefinitions: string };
    return pomDefinitions;
  }
}
