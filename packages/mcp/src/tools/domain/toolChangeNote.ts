import type { HiddenTool } from "../../contract";

/**
 * The tools the agent sees, by name, and the reported tools it does not
 * see because another connection keeps their names.
 */
export type ToolState = {
  names: readonly string[];
  hidden: readonly HiddenTool[];
};

const HIDDEN_BECAUSE = {
  page: "because the page offers a tool with the same name; you reach the page's",
  process:
    "because another App Process offers a tool with the same name; you reach the first App Process's",
} as const;

/**
 * The note on a tool result that tells the agent which tools of the page
 * and App Processes appeared, disappeared or were newly hidden since its
 * previous call, so an agent that never re-reads the MCP tool list still
 * notices. No note when nothing of that changed.
 */
export function toolChangeNote(
  previous: ToolState,
  current: ToolState
): string | undefined {
  const appeared = current.names.filter(
    (name) => !previous.names.includes(name)
  );
  const disappeared = previous.names.filter(
    (name) => !current.names.includes(name)
  );
  const wasHidden = new Set(
    previous.hidden.map(({ name, offeredBy }) => `${offeredBy} ${name}`)
  );
  const hidden = current.hidden.filter(
    ({ name, offeredBy }) => !wasHidden.has(`${offeredBy} ${name}`)
  );
  if (appeared.length === 0 && disappeared.length === 0 && hidden.length === 0)
    return undefined;
  return [
    "The connected tools changed since your previous call.",
    appeared.length > 0 ? `Appeared: ${appeared.join(", ")}.` : undefined,
    disappeared.length > 0
      ? `Disappeared: ${disappeared.join(", ")}.`
      : undefined,
    ...hidden.map(
      ({ name, offeredBy }) => `Hidden: ${name}, ${HIDDEN_BECAUSE[offeredBy]}.`
    ),
    "ayme_list_tools lists the current tools; ayme_call runs any of them.",
  ]
    .filter((line) => line !== undefined)
    .join(" ");
}
