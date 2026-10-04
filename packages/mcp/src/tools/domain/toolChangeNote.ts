/**
 * The note on a tool result that tells the agent which page tools appeared
 * or disappeared since its previous call, so an agent that never re-reads
 * the MCP tool list still notices. `previous` and `current` are tool names;
 * no note when the two hold the same names.
 */
export function toolChangeNote(
  previous: readonly string[],
  current: readonly string[]
): string | undefined {
  const appeared = current.filter((name) => !previous.includes(name));
  const disappeared = previous.filter((name) => !current.includes(name));
  if (appeared.length === 0 && disappeared.length === 0) return undefined;
  return [
    "The page's tools changed since your previous call.",
    appeared.length > 0 ? `Appeared: ${appeared.join(", ")}.` : undefined,
    disappeared.length > 0
      ? `Disappeared: ${disappeared.join(", ")}.`
      : undefined,
    "ayme_list_tools lists the current tools; ayme_call runs any of them.",
  ]
    .filter((line) => line !== undefined)
    .join(" ");
}
