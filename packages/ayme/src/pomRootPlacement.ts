import {
  StructuralNode,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type StructuralRole,
} from "@ayme-dev/core/structural-observation";
type StructuralChild = StructuralNode | string;
export type ReferencedCapturedRoot = {
  kind: "referenced";
  ref: AriaRef;
};

export type OmittedCapturedRoot = {
  kind: "omitted";
  ancestorRef: AriaRef | undefined;
  descendantRefs: readonly AriaRef[];
  role: StructuralRole;
  name: string;
};

export type CapturedStructuralRoot =
  ReferencedCapturedRoot | OmittedCapturedRoot;

export type CapturedStructuralRootPlacement = {
  tree: StructuralTree;
  refs: readonly (AriaRef | null)[];
};

/** Places captured roots using full-tree ancestry and retained-tree order. */
export function placeCapturedRoots(
  retainedTree: StructuralTree,
  fullTree: StructuralTree,
  roots: readonly CapturedStructuralRoot[],
  refFactory: SyntheticAriaRefFactory
): CapturedStructuralRootPlacement {
  let tree = retainedTree;
  const placedRefs: Array<AriaRef | null> = [];
  const fullOrder = new Map(
    fullTree.getAllRefs().map((ref, index) => [ref, index] as const)
  );

  for (const root of roots) {
    if (root.kind === "referenced") {
      if (tree.hasNode(root.ref)) {
        placedRefs.push(root.ref);
        continue;
      }

      const fullNode = fullTree.getNode(root.ref);
      const ancestor = fullTree
        .getAncestorsOf(root.ref)
        .find((candidate) => tree.hasNode(candidate.ref));
      if (!fullNode || !ancestor) {
        placedRefs.push(null);
        continue;
      }

      const boundary = capturedBoundary(fullNode, tree);
      tree = insertBoundary(
        tree,
        ancestor.ref,
        boundary,
        collectDescendantRefs(boundary),
        fullOrder.get(root.ref) ?? Number.MAX_SAFE_INTEGER,
        fullOrder,
        refFactory
      );
      placedRefs.push(tree.hasNode(root.ref) ? root.ref : null);
      continue;
    }

    const descendantRefs = [
      ...new Set(
        root.descendantRefs.filter(
          (ref) => tree.hasNode(ref) && fullTree.hasNode(ref)
        )
      ),
    ];
    if (
      root.ancestorRef === undefined ||
      !tree.hasNode(root.ancestorRef) ||
      descendantRefs.length === 0
    ) {
      placedRefs.push(null);
      continue;
    }

    const descendantSet = new Set(descendantRefs);
    const topLevelDescendants = descendantRefs.filter(
      (ref) =>
        !tree
          .getAncestorsOf(ref)
          .some((ancestor) => descendantSet.has(ancestor.ref))
    );
    const children = topLevelDescendants.flatMap((ref) => {
      const node = tree.getNode(ref);
      return node ? [node] : [];
    });
    if (children.length === 0) {
      placedRefs.push(null);
      continue;
    }

    const syntheticRef = refFactory.create();
    const boundary = new StructuralNode({
      ref: syntheticRef,
      role: root.role,
      name: root.name,
      cursorPointer: false,
      children,
    });
    const boundaryOrder = Math.min(
      ...topLevelDescendants.map(
        (ref) => fullOrder.get(ref) ?? Number.MAX_SAFE_INTEGER
      )
    );
    tree = insertBoundary(
      tree,
      root.ancestorRef,
      boundary,
      new Set(topLevelDescendants),
      boundaryOrder,
      fullOrder,
      refFactory
    );
    placedRefs.push(tree.hasNode(syntheticRef) ? syntheticRef : null);
  }

  return { tree, refs: placedRefs };
}

function capturedBoundary(
  node: StructuralNode,
  tree: StructuralTree
): StructuralNode {
  return node.copy({
    children: node.children.flatMap((child) =>
      typeof child === "string" ? [] : existingDescendants(child, tree)
    ),
  });
}

function existingDescendants(
  node: StructuralNode,
  tree: StructuralTree
): StructuralNode[] {
  const existing = tree.getNode(node.ref);
  if (existing) return [existing];
  return node.children.flatMap((child) =>
    typeof child === "string" ? [] : existingDescendants(child, tree)
  );
}

function collectDescendantRefs(node: StructuralNode): Set<AriaRef> {
  const refs = new Set<AriaRef>();
  node.walk((descendant) => {
    if (descendant !== node) refs.add(descendant.ref);
  });
  return refs;
}

function insertBoundary(
  tree: StructuralTree,
  parentRef: AriaRef,
  boundary: StructuralNode,
  movedRefs: ReadonlySet<AriaRef>,
  boundaryOrder: number,
  fullOrder: ReadonlyMap<AriaRef, number>,
  refFactory: SyntheticAriaRefFactory
): StructuralTree {
  let inserted = false;
  const rebuild = (node: StructuralNode): StructuralNode => {
    const children: StructuralChild[] = [];
    for (const child of node.children) {
      if (typeof child !== "string" && movedRefs.has(child.ref)) continue;
      children.push(typeof child === "string" ? child : rebuild(child));
    }

    if (node.ref === parentRef) {
      const insertionIndex = children.findIndex(
        (child) =>
          typeof child !== "string" &&
          fullTreeOrder(child, fullOrder) > boundaryOrder
      );
      children.splice(
        insertionIndex === -1 ? children.length : insertionIndex,
        0,
        boundary
      );
      inserted = true;
    }
    return node.copy({ children });
  };

  const root = rebuild(tree.root);
  return inserted ? new StructuralTree(root, refFactory) : tree;
}

function fullTreeOrder(
  node: StructuralNode,
  fullOrder: ReadonlyMap<AriaRef, number>
): number {
  if (!(node.ref === "s_root" || node.ref.startsWith("s_"))) {
    const order = fullOrder.get(node.ref);
    if (order !== undefined) return order;
  }

  const descendantOrders = node.children.flatMap((child) =>
    typeof child === "string" ? [] : [fullTreeOrder(child, fullOrder)]
  );
  return descendantOrders.length > 0
    ? Math.min(...descendantOrders)
    : Number.MAX_SAFE_INTEGER;
}
