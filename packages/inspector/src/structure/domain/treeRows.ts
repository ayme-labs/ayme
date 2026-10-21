import type { StructureNode, StructureRow } from "./structure";

/**
 * A row of the tree as the Structure lens shows it. A chain of wrappers
 * folds into one row: the generic the chain ends in, which holds the
 * children shown below it.
 */
export type TreeRow = StructureRow & {
  /** On a folded row: the chain's outermost wrapper, and how many wrappers sit between it and the row's node. */
  folded?: { outer: StructureNode; hidden: number };
  /** On the outermost wrapper of a chain that is unfolded. */
  unfolded?: true;
};

/**
 * Whether a chain of wrappers is unfolded. The chain runs from its
 * outermost wrapper to the generic it ends in.
 */
export type IsUnfolded = (chain: readonly StructureNode[]) => boolean;

/**
 * Every node of the tree as a row, depth first, with each chain of wrappers
 * folded unless it is unfolded. A wrapper is a generic with no name and no
 * Page Object member whose only child is a generic: it adds nesting, nothing
 * an agent reads or acts on.
 */
export function treeRows(
  nodes: readonly StructureNode[],
  isUnfolded: IsUnfolded,
  depth = 0
): TreeRow[] {
  return nodes.flatMap((node) => {
    const chain = wrapperChain(node);
    if (chain.length === 1)
      return [
        { node, depth },
        ...treeRows(node.children, isUnfolded, depth + 1),
      ];
    const end = chain[chain.length - 1]!;
    if (isUnfolded(chain))
      return [
        ...chain.map((link, index) => ({
          node: link,
          depth: depth + index,
          ...(index === 0 ? { unfolded: true as const } : {}),
        })),
        ...treeRows(end.children, isUnfolded, depth + chain.length),
      ];
    return [
      { node: end, depth, folded: { outer: node, hidden: chain.length - 2 } },
      ...treeRows(end.children, isUnfolded, depth + 1),
    ];
  });
}

/**
 * The chain of wrappers a node starts, with the generic it ends in: just the
 * node when it is no wrapper.
 */
export function wrapperChain(node: StructureNode): StructureNode[] {
  const chain = [node];
  for (let link = node; isWrapper(link);) {
    link = link.children[0]!;
    chain.push(link);
  }
  return chain;
}

function isWrapper({ role, name, members, children }: StructureNode) {
  return (
    role === "generic" &&
    name === "" &&
    members.length === 0 &&
    children.length === 1 &&
    children[0]!.role === "generic"
  );
}
