import type { PageObjectNode } from "./pageModel";

/** How the object tree is opened up, which outlives the tree's rows. */
export type ObjectTree = {
  /**
   * The objects opened or closed by hand, by path. The rest are open while
   * they are on the page and closed while they aren't.
   */
  open: Readonly<Record<string, boolean>>;
  /** The selected object whose surrounding objects were last opened. */
  revealed?: string;
};

/**
 * The object tree as it shows with the object at `selectedPath` selected:
 * a selection inside a closed object, from search or a link, opens the
 * objects around it. That happens once per selection, when it is in the
 * tree, so a later close stays closed, across lens switches too. The same
 * object tree when there is nothing to open.
 */
export function revealSelection(
  objects: readonly PageObjectNode[],
  objectTree: ObjectTree,
  selectedPath: string | undefined
): ObjectTree {
  if (selectedPath === objectTree.revealed) return objectTree;
  const around =
    selectedPath === undefined ? [] : ancestors(objects, selectedPath);
  if (around === undefined) return objectTree;
  const closed = around.filter((node) => !isOpen(node, objectTree.open));
  return {
    open: {
      ...objectTree.open,
      ...Object.fromEntries(closed.map((node) => [node.path, true])),
    },
    revealed: selectedPath,
  };
}

/** The rows the tree shows: each object, and the children of the open ones. */
export function* objectRows(
  nodes: readonly PageObjectNode[],
  open: ObjectTree["open"],
  depth = 1
): Generator<{ node: PageObjectNode; depth: number; open?: boolean }> {
  for (const node of nodes) {
    if (!node.children.length) {
      yield { node, depth };
      continue;
    }
    const nodeOpen = isOpen(node, open);
    yield { node, depth, open: nodeOpen };
    if (nodeOpen) yield* objectRows(node.children, open, depth + 1);
  }
}

function isOpen(node: PageObjectNode, open: ObjectTree["open"]) {
  return open[node.path] ?? node.live;
}

/**
 * The objects above the one at `path`, outermost first; undefined when it
 * isn't in the tree.
 */
function ancestors(
  nodes: readonly PageObjectNode[],
  path: string
): PageObjectNode[] | undefined {
  for (const node of nodes) {
    if (node.path === path) return [];
    const below = ancestors(node.children, path);
    if (below) return [node, ...below];
  }
  return undefined;
}
