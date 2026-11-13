import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";

import type { InteractionReport } from "./recorded";

const nodes = (node: StructuralNode) =>
  node.children.filter((child) => typeof child !== "string");

/** The way down to a ref: the place among its siblings of each node on it. */
function pathTo(
  roots: readonly StructuralNode[],
  ref: AriaRef
): number[] | undefined {
  for (const [index, node] of roots.entries()) {
    if (node.ref === ref) return [index];
    const below = pathTo(nodes(node), ref);
    if (below) return [index, ...below];
  }
  return undefined;
}

/**
 * Where a picture of one document can stand in a snapshot: the page itself,
 * then each frame the snapshot lists, in order. A frame's elements are
 * listed under its iframe.
 */
export function scopesOf(tree: StructuralTree): {
  readonly frame: StructuralNode | null;
  readonly roots: StructuralNode[];
}[] {
  const frames: StructuralNode[] = [];
  tree.walk((node) => {
    if (node.role === "iframe") frames.push(node);
  });
  return [
    { frame: null, roots: tree.getRootNodes() },
    ...frames.map((frame) => ({ frame, roots: nodes(frame) })),
  ];
}

/** Whether a picture's top level is that of a scope: the same roles and
 * names, in order. */
export function fitsScope(
  picture: readonly StructuralNode[],
  roots: readonly StructuralNode[]
): boolean {
  return (
    picture.length === roots.length &&
    picture.every(
      (node, index) =>
        node.role === roots[index]!.role && node.name === roots[index]!.name
    )
  );
}

/**
 * The ref, in the report's own picture, of the element the report names:
 * the target, or its nearest ancestor the picture lists when the target is
 * missing from it.
 */
export function namedInPicture(
  picture: StructuralTree,
  target: NonNullable<InteractionReport["target"]>
): AriaRef | undefined {
  for (const candidate of [target.ref, ...(target.ancestors ?? [])]) {
    if (candidate === null) continue;
    const parsed = AriaRefSchema.safeParse(candidate);
    if (parsed.success && picture.hasNode(parsed.data)) return parsed.data;
  }
  return undefined;
}

/**
 * The ref, in a snapshot's tree, of the element a report names.
 *
 * Playwright's recorder gives each report its own picture of the page, taken
 * at the moment of the Interaction and numbered by itself. For an input the
 * gate held, the snapshot taken just before it shows the same page, so the
 * target is the node at the same place in both: in the page, or in the
 * frame whose top level is the picture's. It is taken only when the two
 * nodes agree on role and name; otherwise the target is unknown.
 */
export function locateTarget(
  before: StructuralTree,
  target: InteractionReport["target"]
): AriaRef | undefined {
  if (!target) return undefined;
  // A factory of its own: the picture is read only here.
  const picture = StructuralTree.fromAriaSnapshotYaml(
    target.tree,
    new SyntheticAriaRefFactory()
  );
  const ref = namedInPicture(picture, target);
  if (!ref) return undefined;
  const path = pathTo(picture.getRootNodes(), ref);
  const named = picture.getNode(ref);
  if (!path || !named) return undefined;
  for (const scope of scopesOf(before)) {
    if (!fitsScope(picture.getRootNodes(), scope.roots)) continue;
    let level = scope.roots;
    let found: StructuralNode | undefined;
    for (const index of path) {
      found = level[index];
      if (!found) break;
      level = nodes(found);
    }
    if (found?.role === named.role && found.name === named.name)
      return found.ref;
  }
  return undefined;
}
