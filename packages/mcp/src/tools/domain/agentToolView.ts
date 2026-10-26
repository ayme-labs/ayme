import type { PageTool } from "../../contract";
import { toolChangeNote, type ToolState } from "./toolChangeNote";
import { mcpPageTool } from "./toolResult";

/**
 * What one agent has been shown of the page's and App Processes' tools:
 * the MCP tool list as last announced, the tools as of its last view of
 * them, and every name ever offered. The MCP server reports what happens
 * and asks it what to tell the agent.
 *
 * The MCP list leaves out a page tool that shares a server tool's name.
 * `ayme_list_tools` lists the connection's tools as they are, so it does
 * not ask this.
 */
export class AgentToolView {
  readonly #serverToolNames: ReadonlySet<string>;
  readonly #offered = new Set<string>();
  // The list as the agent last could read it, to tell a change to it from
  // a change in availability only.
  #announced = "[]";
  // The tools as of the previous result or tool list, whichever came later;
  // an agent that has had neither has seen no tools.
  #seen: ToolState = { tools: [], hidden: [] };

  /** `tools` are the connection's tools as the server starts. */
  constructor(serverToolNames: Iterable<string>, tools: readonly PageTool[]) {
    this.#serverToolNames = new Set(serverToolNames);
    this.toolsChanged(tools);
  }

  /** The page tools the MCP list shows of the connection's `tools`. */
  listed(tools: readonly PageTool[]): readonly PageTool[] {
    return tools.filter((tool) => !this.#serverToolNames.has(tool.name));
  }

  /**
   * The connection's tools changed to `tools`. True when the MCP list
   * changed since it was last announced, and not when a tool merely became
   * available or unavailable: the list has no field for that (ADR-0035).
   */
  toolsChanged(tools: readonly PageTool[]): boolean {
    for (const tool of tools) this.#offered.add(tool.name);
    const current = JSON.stringify(this.listed(tools).map(mcpPageTool));
    if (current === this.#announced) return false;
    this.#announced = current;
    return true;
  }

  /**
   * The agent read the MCP tool list of the connection's `tools`; returns
   * the page tools it shows.
   */
  listRead(tools: readonly PageTool[]): readonly PageTool[] {
    const listed = this.listed(tools);
    // The list shows each tool's description and input schema but neither
    // availability nor hidden tools, so the agent keeps what it last heard
    // of those, and takes a tool new to it as available.
    this.#seen = {
      tools: listed.map(({ name, description, inputSchema }) => ({
        ...(this.#seen.tools.find((tool) => tool.name === name) ?? {
          available: true,
        }),
        name,
        description,
        inputSchema,
      })),
      hidden: this.#seen.hidden,
    };
    return listed;
  }

  /**
   * A tool result goes to the agent while the connection has `tools` and
   * `hidden`; returns the note of what changed since its previous view, if
   * anything did.
   */
  resultReturned({ tools, hidden }: ToolState): string | undefined {
    const current: ToolState = { tools: this.listed(tools), hidden };
    const note = toolChangeNote(this.#seen, current);
    this.#seen = current;
    return note;
  }

  /** Whether the connection ever offered a tool `name`, to tell a gone tool from an unknown one. */
  wasOffered(name: string): boolean {
    return this.#offered.has(name);
  }
}
