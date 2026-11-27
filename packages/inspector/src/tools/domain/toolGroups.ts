/** Where a tool comes from, as the runtime groups it. */
export type ToolGroup = "pageObject" | "browser" | "custom" | "peek" | "agent";

/**
 * A live tool: one the panel can run now, because its Page Object or
 * element is on the page. Published to WebMCP or not.
 */
export type LiveTool = {
  name: string;
  agentDescription?: string;
  inputSchema: unknown;
  group: ToolGroup;
  /** For a Page object tool: the Page Object Model whose action it is. */
  className?: string;
  /** Its author marked it destructive: a call cannot be undone. */
  destructive?: true;
};

/** The Inspector's label for each group. They are UI labels, not glossary terms. */
export const toolGroupLabels: Record<ToolGroup, string> = {
  pageObject: "Page object tools",
  browser: "Browser tools",
  custom: "Custom tools",
  peek: "Peek tools",
  agent: "Agent tools",
};

// Stryker disable StringLiteral: display labels, a lookup table.
/** What one tool of each group is called on its page. */
export const toolKindLabels: Record<ToolGroup, string> = {
  pageObject: "Page object tool",
  browser: "Browser tool",
  custom: "Custom tool",
  peek: "Peek tool",
  agent: "Agent tool",
};
// Stryker restore StringLiteral

const groupOrder: readonly ToolGroup[] = [
  "pageObject",
  "custom",
  "browser",
  "peek",
  "agent",
];

/** One group of the Tools lens. */
export type ToolGroupListing = {
  group: ToolGroup;
  label: string;
  tools: LiveTool[];
};

/**
 * The live tools, grouped in a fixed order and keeping the runtime's order
 * within a group. A group without tools is left out.
 */
export function listTools(tools: readonly LiveTool[]): ToolGroupListing[] {
  return groupOrder
    .map((group): ToolGroupListing => ({
      group,
      label: toolGroupLabels[group],
      tools: tools.filter((tool) => tool.group === group),
    }))
    .filter(({ tools }) => tools.length > 0);
}
