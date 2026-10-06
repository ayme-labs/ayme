/** Where a tool comes from, as the runtime groups it. */
export type ToolGroup = "pageObject" | "browser" | "custom" | "peek" | "agent";

/**
 * A live tool: one the panel can run now, because its Page Object or
 * element is on the page. Published to WebMCP or not.
 */
export type LiveTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  group: ToolGroup;
  /** For a Page object tool: the Page Object Model whose action it is. */
  pomClassName?: string;
  /**
   * For a Peek tool: where its Peek lives. `node` is an App Process's, a
   * Node process of the app paired beside the page, which the panel runs
   * through the agent's Ayme MCP server. The page's otherwise.
   */
  side?: PeekSide;
};

/** Where a Peek tool's Peek lives: the page, or an App Process. */
export type PeekSide = "browser" | "node";

/** The Inspector's label for each side's Peek tools. UI labels too. */
export const peekSideLabels: Record<PeekSide, string> = {
  browser: "Browser",
  node: "Node",
};

/** The Inspector's label for each group. They are UI labels, not glossary terms. */
export const toolGroupLabels: Record<ToolGroup, string> = {
  pageObject: "Page object tools",
  browser: "Browser tools",
  custom: "Custom tools",
  peek: "Peek tools",
  agent: "Agent tools",
};

/** What one tool of each group is called on its page. */
export const toolKindLabels: Record<ToolGroup, string> = {
  pageObject: "Page object tool",
  browser: "Browser tool",
  custom: "Custom tool",
  peek: "Peek tool",
  agent: "Agent tool",
};

const groupOrder: readonly ToolGroup[] = [
  "pageObject",
  "custom",
  "browser",
  "peek",
  "agent",
];

/** The Peek tools of one side, a section of the Peek tools group. */
export type PeekSection = {
  side: PeekSide;
  label: string;
  tools: LiveTool[];
};

/** One group of the Tools lens. */
export type ToolGroupListing = {
  group: ToolGroup;
  label: string;
  tools: LiveTool[];
  /**
   * The Peek tools group's sections: the page's (Browser), then the App
   * Processes' (Node). A section without tools is left out.
   */
  sections?: PeekSection[];
};

const sideOrder: readonly PeekSide[] = ["browser", "node"];

/**
 * The live tools, grouped in a fixed order and keeping the runtime's order
 * within a group. A group without tools is left out. The Peek tools group
 * lists the page's Peek tools, then the App Processes', in its sections.
 */
export function listTools(tools: readonly LiveTool[]): ToolGroupListing[] {
  return groupOrder
    .map((group): ToolGroupListing => {
      const inGroup = tools.filter((tool) => tool.group === group);
      const label = toolGroupLabels[group];
      if (group !== "peek") return { group, label, tools: inGroup };
      const sections = sideOrder
        .map((side) => ({
          side,
          label: peekSideLabels[side],
          tools: inGroup.filter((tool) => (tool.side ?? "browser") === side),
        }))
        .filter(({ tools }) => tools.length > 0);
      return {
        group,
        label,
        tools: sections.flatMap(({ tools }) => tools),
        sections,
      };
    })
    .filter(({ tools }) => tools.length > 0);
}

/** A Page Object Model and the tools its actions publish as. */
export type ToolModel = {
  className: string;
  tools: readonly { name: string }[];
};

/**
 * Adds to each Page object tool the Page Object Model whose action it is.
 * The first model that lists a tool's name owns it.
 */
export function attachToolModels(
  tools: readonly Omit<LiveTool, "pomClassName">[],
  models: readonly ToolModel[]
): LiveTool[] {
  const modelByTool = new Map<string, string>();
  for (const model of models)
    for (const { name } of model.tools)
      if (!modelByTool.has(name)) modelByTool.set(name, model.className);
  return tools.map((tool) => {
    const pomClassName =
      tool.group === "pageObject" ? modelByTool.get(tool.name) : undefined;
    return pomClassName ? { ...tool, pomClassName } : { ...tool };
  });
}
