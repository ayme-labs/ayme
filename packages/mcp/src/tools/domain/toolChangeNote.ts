import { HIDDEN_BECAUSE, type PageTool } from "../../contract";

/** A tool the agent sees: its name, and whether a call can run it now. */
export type SeenTool = Pick<PageTool, "name" | "available" | "reason"> &
  Partial<Pick<PageTool, "description" | "inputSchema">>;

/**
 * The tools the agent sees, and the names of the reported tools it does not
 * see because an earlier App Process keeps them.
 */
export type ToolState = {
  tools: readonly SeenTool[];
  hidden: readonly string[];
};

/** A tool's name, with why it cannot run when it cannot and the page said. */
const withReason = ({ name, reason }: SeenTool) =>
  reason === undefined ? name : `${name} (${reason})`;

/** An appeared tool's name, marked unavailable when it is, with its reason. */
const asAppeared = (tool: SeenTool) =>
  tool.available
    ? tool.name
    : `${tool.name} (unavailable${tool.reason === undefined ? "" : `: ${tool.reason}`})`;

/**
 * The note on a tool result that tells the agent which tools of the page
 * and App Processes appeared, disappeared, became available or unavailable
 * (with the reason) or were newly hidden since its previous call, so an
 * agent that never re-reads the MCP tool list still notices. No note when
 * nothing of that changed.
 */
export function toolChangeNote(
  previous: ToolState,
  current: ToolState,
  // Experiment (tool-list-notification pilot): also carry each appeared tool's
  // description and input schema, so an agent whose harness ignores
  // list_changed can call it through ayme_call without listing tools first.
  { schemas = false }: { schemas?: boolean } = {}
): string | undefined {
  const before = new Map(previous.tools.map((tool) => [tool.name, tool]));
  const appeared = current.tools.filter(({ name }) => !before.has(name));
  const disappeared = previous.tools.filter(
    ({ name }) => !current.tools.some((tool) => tool.name === name)
  );
  const stayed = current.tools.filter(({ name }) => before.has(name));
  const becameAvailable = stayed.filter(
    (tool) => tool.available && !before.get(tool.name)!.available
  );
  const becameUnavailable = stayed.filter(
    (tool) => !tool.available && before.get(tool.name)!.available
  );
  const hidden = current.hidden.filter(
    (name) => !previous.hidden.includes(name)
  );
  const lines = [
    appeared.length > 0
      ? `Appeared: ${appeared.map(asAppeared).join(", ")}.`
      : undefined,
    disappeared.length > 0
      ? `Disappeared: ${disappeared.map(({ name }) => name).join(", ")}.`
      : undefined,
    becameAvailable.length > 0
      ? `Became available: ${becameAvailable.map(({ name }) => name).join(", ")}.`
      : undefined,
    becameUnavailable.length > 0
      ? `Became unavailable: ${becameUnavailable.map(withReason).join(", ")}.`
      : undefined,
    ...hidden.map(
      (name) =>
        `Hidden: ${name}, because ${HIDDEN_BECAUSE}; you reach the first App Process's.`
    ),
  ].filter((line) => line !== undefined);
  if (lines.length === 0) return undefined;
  const summary = [
    "The connected tools changed since your previous call.",
    ...lines,
    "ayme_list_tools lists the current tools; ayme_call runs any of them.",
  ].join(" ");
  const described = schemas
    ? appeared.filter((tool) => tool.inputSchema !== undefined)
    : [];
  if (described.length === 0) return summary;
  return [
    summary,
    "The appeared tools, callable by name or through ayme_call:",
    ...described.map(
      ({ name, description, inputSchema }) =>
        `- ${name}: ${description ?? ""} Input schema: ${JSON.stringify(inputSchema)}`
    ),
  ].join("\n");
}
