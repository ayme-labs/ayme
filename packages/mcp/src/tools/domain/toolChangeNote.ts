import { isDeepStrictEqual } from "node:util";

import { HIDDEN_BECAUSE, type PageTool } from "../../contract";

/**
 * A tool the agent sees: its name, whether a call can run it now, and what
 * it was told about the tool's parameters and purpose.
 */
export type SeenTool = PageTool;

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

/** A changed tool's name, with which of its parameters and description changed. */
const asChanged = (tool: SeenTool, before: SeenTool) => {
  const parts = [
    isDeepStrictEqual(tool.inputSchema, before.inputSchema)
      ? undefined
      : "parameters",
    tool.description === before.description ? undefined : "description",
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : `${tool.name} (${parts.join(", ")})`;
};

/**
 * The note on a tool result that tells the agent which tools of the page
 * and App Processes appeared, disappeared, changed their parameters or
 * description, became available or unavailable
 * (with the reason) or were newly hidden since its previous call, so an
 * agent that never re-reads the MCP tool list still notices. No note when
 * nothing of that changed.
 */
export function toolChangeNote(
  previous: ToolState,
  current: ToolState
): string | undefined {
  const before = new Map(previous.tools.map((tool) => [tool.name, tool]));
  const appeared = current.tools.filter(({ name }) => !before.has(name));
  const disappeared = previous.tools.filter(
    ({ name }) => !current.tools.some((tool) => tool.name === name)
  );
  const stayed = current.tools.filter(({ name }) => before.has(name));
  const changed = stayed
    .map((tool) => asChanged(tool, before.get(tool.name)!))
    .filter((line) => line !== undefined);
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
    changed.length > 0 ? `Changed: ${changed.join(", ")}.` : undefined,
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
  return [
    "The connected tools changed since your previous call.",
    ...lines,
    "ayme_list_tools lists the current tools; ayme_call runs any of them.",
  ].join(" ");
}
