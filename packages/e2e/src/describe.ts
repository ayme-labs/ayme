/**
 * What a node id from the agent's screen names, in the terms a repair
 * proposal needs: the control's role and name, and the nearest container it
 * sits in. Ids are e2e's per-screen node ids; the executor resolves them
 * against the step's own observation before the action changes the screen.
 */

import type { ExecutorNode, StepExecutorContext } from "e2e";

export interface NodeTarget {
  readonly role?: string;
  readonly name?: string;
  readonly within?: string;
}

/** Containers named by their own label: a section, a dialog, a group, a tab panel. */
const LABELLED = new Set(["region", "dialog", "group", "tabpanel", "form"]);
/** Containers named by their content: a row, a list item, an article. */
const ROWS = new Set(["row", "listitem", "article"]);

/** The path from the tree's root to the node with `id`, or undefined. */
function pathTo(
  node: ExecutorNode | undefined,
  id: string
): ExecutorNode[] | undefined {
  if (node === undefined) return undefined;
  if (node.id === id) return [node];
  for (const child of node.children ?? []) {
    const path = pathTo(child, id);
    if (path !== undefined) return [node, ...path];
  }
  return undefined;
}

/** The node an id names on the current screen, with its nearest named container; undefined when the screen no longer lists it. */
export async function describeNode(
  ctx: StepExecutorContext,
  id: string
): Promise<NodeTarget | undefined> {
  const path = pathTo(
    (await ctx.observe({ tree: true })).tree,
    id.replace(/^#/, "")
  );
  const node = path?.at(-1);
  if (path === undefined || node === undefined) return undefined;
  const container = path
    .slice(0, -1)
    .reverse()
    .find(
      (ancestor) =>
        (LABELLED.has(ancestor.role ?? "") && ancestor.name !== undefined) ||
        ROWS.has(ancestor.role ?? "")
    );
  const within = container?.name ?? container?.text;
  return {
    ...(node.role === undefined ? {} : { role: node.role }),
    ...(node.name === undefined ? {} : { name: node.name }),
    ...(within === undefined || within === node.name ? {} : { within }),
  };
}

/** One line of prose for an action on a target: `tap button "Add project" in "Projects"`. */
export function describeAction(
  verb: string,
  target: NodeTarget | undefined
): string {
  if (target === undefined) return verb;
  const what = [
    target.role,
    target.name === undefined ? undefined : JSON.stringify(target.name),
  ]
    .filter(Boolean)
    .join(" ");
  return `${verb} ${what}${target.within === undefined ? "" : ` in ${JSON.stringify(target.within)}`}`.trim();
}
