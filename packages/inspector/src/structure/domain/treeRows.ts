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
 * The unfolded chains as the tree shows them with the node `selectedRef`
 * selected: a selected wrapper the fold hides unfolds its chain, which
 * stays unfolded once stored, like one the person unfolded. The same set
 * when the selection hides in no folded chain.
 */
export function shownUnfolded(
  roots: readonly StructureNode[],
  unfoldedChains: ReadonlySet<string>,
  selectedRef: string | undefined
): ReadonlySet<string> {
  const isUnfolded: IsUnfolded = (chain) => unfoldedChains.has(chain[0]!.ref!);
  for (const { folded } of treeRows(roots, isUnfolded))
    if (folded && hides(wrapperChain(folded.outer), selectedRef))
      return new Set(unfoldedChains).add(folded.outer.ref!);
  return unfoldedChains;
}

/**
 * Folds or unfolds the chain that `outer` leads, from the unfolded chains
 * as the tree shows them. Folding a chain that hides the selected wrapper
 * moves the selection to `outer`, so it stays in view.
 */
export function toggleChain(
  shown: ReadonlySet<string>,
  outer: StructureNode & { ref: string },
  selectedRef: string | undefined
): { unfolded: ReadonlySet<string>; select?: string } {
  const unfolded = new Set(shown);
  if (!unfolded.delete(outer.ref)) return { unfolded: unfolded.add(outer.ref) };
  return hides(wrapperChain(outer), selectedRef)
    ? { unfolded, select: outer.ref }
    : { unfolded };
}

/** Whether folding the chain hides the node `ref`: one between its ends. */
function hides(chain: readonly StructureNode[], ref?: string) {
  return chain.slice(1, -1).some((link) => link.ref === ref);
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
