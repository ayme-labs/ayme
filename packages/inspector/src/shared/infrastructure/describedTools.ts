import type { ToolInfo } from "@ayme-dev/ayme";
import { describeTool, type RegisteredPom } from "@ayme-dev/ayme/internal";

/** A tool as `describeTool` reads it. */
type Described = {
  name: string;
  description?: string;
  returnPoms?: readonly string[];
};

/**
 * `tool` with the description the Inspector shows, which is what Ayme MCP
 * gives agents: the same tool when that is its own description, or when
 * there is none.
 */
function described<T extends Described>(tool: T): T {
  const description = describeTool(tool, "inspector");
  return description === undefined || description === tool.description
    ? tool
    : { ...tool, description };
}

/**
 * The registered Page Objects, with their tools described as the Inspector
 * shows them, whether or not their Page Object is on the page. A
 * registration none of whose descriptions change is the same object.
 */
export function describeRegisteredPoms(
  registrations: readonly RegisteredPom[]
): RegisteredPom[] {
  return registrations.map((registration) => {
    const tools = registration.tools.map(described);
    return tools.every((tool, index) => tool === registration.tools[index])
      ? registration
      : { ...registration, tools };
  });
}

/** The session's live tools, described as the Inspector shows them. */
export function describeLiveTools(
  tools: readonly ToolInfo[]
): readonly ToolInfo[] {
  return tools.map(described);
}
