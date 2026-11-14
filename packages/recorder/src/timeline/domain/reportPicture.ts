import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";

import { scopesFor } from "./target";

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
 * snapshot: an element both snapshots have is missing from it. Null also
 * when it cannot be told which document the picture is of: the report has no
 * selector, or two frames fit it alike.
 *
 * `between` is the earlier snapshot reconciled with the later one. Typing
 * and a choice are reported once the field has changed, so with
 * `targetAsBefore` the target is taken as the earlier snapshot has it.
 */
export function pictureBefore(options: {
  readonly previous: StructuralTree;
  readonly between: StructuralTree;
  readonly picture: string;
  /** Playwright's selector for the target: it says which document the input
   * was given to, and so which document the picture is of. */
  readonly selector: string | null;
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
  // An element as the earlier snapshot has it; null for one only the later
  // snapshot has, whose ref the earlier one never used.
  const asBefore = (node: StructuralNode) =>
    between.getBeforeNode(node.ref) ?? previous.getNode(node.ref);
  // Stryker disable next-line OptionalChaining: equivalent, since core gives every node of a reconciled tree a status
  const kind = (node: StructuralNode) => node.status?.kind;
  // Among look-alikes, an element both snapshots have comes first, then one
  // only the earlier snapshot has, then whatever is left: one only the later
  // snapshot has.
  const tiers = [
    (node: StructuralNode) =>
      kind(node) !== "added" && kind(node) !== "removed",
    (node: StructuralNode) => kind(node) === "removed",
    () => true,
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

  // What one reading of the picture has matched so far, by the ref each
  // element has in `between`.
  let matched = new Set<AriaRef>();
  let target: AriaRef | undefined;

  function pair(seen: readonly StructuralNode[], known: StructuralNode[]) {
    const pairs = new Map<StructuralNode, StructuralNode>();
    for (const fits of [same, alike])
      for (const node of seen) {
        if (pairs.has(node)) continue;
        for (const tier of tiers) {
          const hit = known.find(
            (candidate) =>
              !matched.has(candidate.ref) &&
              tier(candidate) &&
              fits(node, candidate)
          );
          if (!hit) continue;
          pairs.set(node, hit);
          matched.add(hit.ref);
          break;
        }
      }
    return pairs;
  }

  function build(
    seen: StructuralNode,
    known: StructuralNode | undefined
  ): StructuralNode {
    const isTarget = seen.ref === options.target;
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
        before.walk((node) => matched.add(node.ref));
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

  // The document the picture is of: one the report's selector allows, whose
  // elements the picture all has.
  const readings: PictureBefore[] = [];
  for (const scope of scopesFor(between, options.selector)) {
    matched = new Set();
    target = undefined;
    const roots = pair(picture.getRootNodes(), scope.roots);
    const built = picture
      .getRootNodes()
      .map((root) => build(root, roots.get(root)));
    // Every element the two snapshots agree on was there at the moment of
    // the input too, unless the picture is of another shape.
    let complete = true;
    const check = (node: StructuralNode) => {
      if (kind(node) === "added" || kind(node) === "removed") return;
      if (!matched.has(node.ref)) complete = false;
      // A frame's elements stand as the earlier snapshot has them: they are
      // matched with their frame.
      nodes(node).forEach(check);
    };
    scope.roots.forEach(check);
    if (!complete) continue;
    if (!scope.frame) {
      if (built.length === 1)
        readings.push({ tree: new StructuralTree(built[0]!, refs), target });
      continue;
    }
    // Outside the frame, the page stands as the earlier snapshot has it.
    const frame = scope.frame.ref;
    const outside = (node: StructuralNode): StructuralNode =>
      node.ref === frame
        ? node.copy({ children: built })
        : node.copy({
            children: node.children.map((child) =>
              typeof child === "string" ? child : outside(child)
            ),
          });
    readings.push({
      tree: new StructuralTree(outside(previous.root), refs),
      target,
    });
  }
  // Two frames the picture fits alike: which one the input was given to
  // cannot be told, and a guess could name the wrong element.
  return readings.length === 1 ? readings[0]! : null;
}
