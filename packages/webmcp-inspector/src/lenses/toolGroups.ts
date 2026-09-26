/** Where a published tool comes from, as the runtime groups it. */
export type ToolGroup = "pageObject" | "ref" | "agent";

/** A tool WebMCP publishes now, as an agent sees it. */
export type PublishedTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  group: ToolGroup;
  /** For a Page object tool: the Page Object Model whose action it is. */
  pomClassName?: string;
};

/** The runtime's WebMCP publication status. */
export type Publication = {
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
};

/** The Inspector's label for each group. They are UI labels, not glossary terms. */
export const toolGroupLabels: Record<ToolGroup, string> = {
  pageObject: "Page object tools",
  ref: "Ref tools",
  agent: "Agent tools",
};

/** What one tool of each group is called on its page. */
export const toolKindLabels: Record<ToolGroup, string> = {
  pageObject: "Page object tool",
  ref: "Ref tool",
  agent: "Agent tool",
};

const groupOrder: readonly ToolGroup[] = ["pageObject", "ref", "agent"];

/** What the Tools lens lists. */
export type ToolListing =
  | {
      kind: "groups";
      groups: { group: ToolGroup; label: string; tools: PublishedTool[] }[];
    }
  | { kind: "empty" }
  | { kind: "failed"; message: string };

/**
 * The published tools, grouped in a fixed order and keeping publication
 * order within a group. Only tools published while publication is active
 * are listed. A failed publication lists its error instead.
 */
export function listTools(
  tools: readonly PublishedTool[],
  publication: Publication
): ToolListing {
  if (publication.state === "failed" && publication.message)
    return { kind: "failed", message: publication.message };
  const published = publication.state === "active" ? tools : [];
  const groups = groupOrder
    .map((group) => ({
      group,
      label: toolGroupLabels[group],
      tools: published.filter((tool) => tool.group === group),
    }))
    .filter(({ tools }) => tools.length > 0);
  return groups.length > 0 ? { kind: "groups", groups } : { kind: "empty" };
}
