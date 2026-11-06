import { inspectorClient } from "../../shared";
import type { StructureNode } from "../../structure";

/**
 * Which nodes of the structure a tool can use: the refs the tool can take
 * in the page state, as the runtime offers them to the Goal Loop. A tool
 * the runtime lists no targets for, such as one that isn't a single-element tool, can
 * use every node: then it's undefined.
 *
 * @param elementToolTargets the refs each published single-element tool can take, by name.
 */
export function refFilterOf(
  elementToolTargets: ReadonlyMap<string, readonly string[]>,
  toolName: string
): ((node: StructureNode & { ref: string }) => boolean) | undefined {
  const targets = elementToolTargets.get(toolName);
  if (!targets) return undefined;
  const usable = new Set(targets);
  return (node) => usable.has(node.ref);
}

/**
 * What picking with a tool asks the person to click, e.g. "Click a text
 * field to fill".
 */
export function pickPromptOf(toolName: string): string {
  switch (toolName) {
    case "click":
      return "Click an element to click";
    case "hover":
      return "Click an element to hover";
    case "type":
      return "Click a text field to type into";
    case "fill":
      return "Click a text field to fill";
    case "check":
      return "Click a checkbox to check";
    case "uncheck":
      return "Click a checkbox to uncheck";
    case "select_option":
      return "Click a select to choose from";
    default:
      return `Click an element for ${toolName}`;
  }
}

/** How picking a ref on the page ends: with the ref picked, or none. */
export type RefPickingHandlers = {
  /** Whether a ref can be picked. The element of one that can't shows greyed. */
  accept: (ref: string) => boolean;
  /** Called once: with the ref clicked, or with none when Esc cancels. */
  onEnd: (ref: string | undefined) => void;
};

/**
 * Picks a ref by pointing at the page, through the Inspector contract: the
 * element under the pointer that carries a ref is boxed, or greyed when it
 * can't be picked; a click picks it and Esc cancels. The page doesn't act on
 * those presses, and the Inspector's own elements are left alone.
 *
 * @param refs the refs the page state shows, of which `accept` takes some.
 * @returns stops picking without calling `onEnd`.
 */
export function startRefPicking({
  accept,
  onEnd,
  refs,
}: RefPickingHandlers & { refs: Iterable<string> }): () => void {
  const stop = new AbortController();
  void inspectorClient()
    .pick([...refs].filter(accept), stop.signal)
    .then((ref) => {
      if (!stop.signal.aborted) onEnd(ref);
    });
  return () => stop.abort();
}
