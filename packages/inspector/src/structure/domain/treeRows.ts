import {
  structureRows,
  type StructureNode,
  type StructureRow,
} from "./structure";

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
 * folded unless it is unfolded. A wrapper is a generic with no name, no
 * Page Object member, no states, no properties and no pointer cursor, whose
 * only child is a generic: it adds nesting, nothing an agent reads or acts on.
 */
export function* treeRows(
  nodes: readonly StructureNode[],
  isUnfolded: IsUnfolded,
  depth = 0
): Generator<TreeRow> {
  for (const node of nodes) {
    const chain = wrapperChain(node);
    const end = chain[chain.length - 1]!;
    let endDepth = depth;
    if (chain.length === 1) yield { node, depth };
    else if (!isUnfolded(chain))
      yield {
        node: end,
        depth,
        folded: { outer: node, hidden: chain.length - 2 },
      };
    else {
      yield { node, depth, unfolded: true };
      for (const [index, link] of chain.slice(1).entries())
        yield { node: link, depth: depth + index + 1 };
      endDepth += chain.length - 1;
    }
    yield* treeRows(end.children, isUnfolded, endDepth + 1);
  }
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

function isWrapper(node: StructureNode) {
  const { role, name, members, children } = node;
  return (
    role === "generic" &&
    name === "" &&
    members.length === 0 &&
    // Its own line is all an agent reads of it: no states, no properties,
    // and nothing that marks it clickable.
    node.state === undefined &&
    node.cursorPointer === undefined &&
    node.control === undefined &&
    (node.pageStateLines?.length ?? 1) <= 1 &&
    children.length === 1 &&
    children[0]!.role === "generic"
  );
}

/**
 * The unfolded chains still on the page: those whose outermost wrapper's
 * ref the tree holds. The same set when all are.
 */
export function unfoldedOnPage(
  unfoldedChains: ReadonlySet<string>,
  roots: readonly StructureNode[]
): ReadonlySet<string> {
  const refs = new Set([...structureRows(roots)].map(({ node }) => node.ref));
  return [...unfoldedChains].every((ref) => refs.has(ref))
    ? unfoldedChains
    : new Set([...unfoldedChains].filter((ref) => refs.has(ref)));
}
