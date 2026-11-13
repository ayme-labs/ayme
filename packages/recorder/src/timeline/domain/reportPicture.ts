import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";

// An input the gate never holds, as typing, has no snapshot of its own just
// before it. Playwright's report carries a picture of the page taken at the
// moment of the input, in the notation of a snapshot but numbered by itself.
// Matched to the snapshots around the input, it says which of the changes
// between them were already there, and which the input made.

const nodes = (node: StructuralNode) =>
  node.children.filter((child) => typeof child !== "string");

/** How the page stood at the moment of an input, under the snapshots' refs. */
export type PictureBefore = {
  readonly tree: StructuralTree;
  /** The target's ref in `tree`, if the picture names one that matched. */
  readonly target: AriaRef | undefined;
};

/**
 * The page as the report's picture shows it, each element under the ref the
 * snapshots give it: the earlier snapshot's ref for an element it has, the
 * later one's for an element only that one has, and a ref of its own for an
 * element neither has. Null when the picture is not of the shape of a
 * snapshot: an element both snapshots have is missing from it.
 *
 * `between` is the earlier snapshot reconciled with the later one. Typing
 * and a choice are reported once the field has changed, so with
 * `targetAsBefore` the target is taken as the earlier snapshot has it.
 */
export function pictureBefore(options: {
  readonly previous: StructuralTree;
  readonly between: StructuralTree;
  readonly picture: string;
  readonly target: string | null;
  readonly targetAsBefore: boolean;
  readonly refs: SyntheticAriaRefFactory;
}): PictureBefore | null {
  const { previous, between, refs } = options;
  // Its refs are its own: read with a factory of its own.
  const picture = StructuralTree.fromAriaSnapshotYaml(
    options.picture,
    new SyntheticAriaRefFactory()
  );
  const asBefore = (node: StructuralNode) =>
    node.status?.kind === "added"
      ? null
      : (between.getBeforeNode(node.ref) ?? previous.getNode(node.ref));
  const kind = (node: StructuralNode) => node.status?.kind;
  // Among look-alikes, an element both snapshots have comes first.
  const tiers = [
    (node: StructuralNode) =>
      kind(node) !== "added" && kind(node) !== "removed",
    (node: StructuralNode) => kind(node) === "removed",
    (node: StructuralNode) => kind(node) === "added",
  ];
  const same = (seen: StructuralNode, node: StructuralNode) => {
    const before = asBefore(node);
    return (
      seen.isShallowEqual(node) ||
      (before !== null && seen.isShallowEqual(before))
    );
  };
  // Text that changed meanwhile: the role and the name are left.
  const alike = (seen: StructuralNode, node: StructuralNode) =>
    seen.role === node.role && seen.name === node.name;

  const matched = new Set<StructuralNode>();
  let target: AriaRef | undefined;

  function pair(seen: readonly StructuralNode[], known: StructuralNode[]) {
    const pairs = new Map<StructuralNode, StructuralNode>();
    for (const fits of [same, alike])
      for (const node of seen) {
        if (pairs.has(node)) continue;
        for (const tier of tiers) {
          const hit = known.find(
            (candidate) =>
              !matched.has(candidate) &&
              tier(candidate) &&
              fits(node, candidate)
          );
          if (!hit) continue;
          pairs.set(node, hit);
          matched.add(hit);
          break;
        }
      }
    return pairs;
  }

  function build(
    seen: StructuralNode,
    known: StructuralNode | undefined
  ): StructuralNode {
    const isTarget = options.target !== null && seen.ref === options.target;
    const ref = known?.ref ?? refs.create();
    if (isTarget) target = ref;
    // The picture never holds what is inside a frame; the target has
    // changed already: both stand as the earlier snapshot has them.
    if (
      known &&
      (known.role === "iframe" || (isTarget && options.targetAsBefore))
    ) {
      const before = asBefore(known);
      if (before) {
        before.walk((node) => {
          const inBetween = between.getNode(node.ref);
          if (inBetween) matched.add(inBetween);
        });
        return before;
      }
    }
    const pairs = known
      ? pair(nodes(seen), nodes(known))
      : new Map<StructuralNode, StructuralNode>();
    return seen.copy({
      ref,
      status: undefined,
      children: seen.children.map((child) =>
        typeof child === "string" ? child : build(child, pairs.get(child))
      ),
    });
  }

  const roots = pair(picture.getRootNodes(), between.getRootNodes());
  const built = picture
    .getRootNodes()
    .map((root) => build(root, roots.get(root)));
  if (built.length !== 1) return null;

  // Every element the two snapshots agree on was there at the moment of the
  // input too, unless the picture is of another shape.
  let complete = true;
  const check = (node: StructuralNode) => {
    if (kind(node) === "added" || kind(node) === "removed") return;
    if (!matched.has(node)) complete = false;
    if (node.role !== "iframe") nodes(node).forEach(check);
  };
  between.getRootNodes().forEach(check);
  if (!complete) return null;
  return { tree: new StructuralTree(built[0]!, refs), target };
}
