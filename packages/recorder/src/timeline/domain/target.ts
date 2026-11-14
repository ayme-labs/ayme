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

/** One document of a snapshot: the page (`frame` is null), or a frame,
 * whose elements the snapshot lists under its iframe. */
export type Scope = {
  readonly frame: StructuralNode | null;
  readonly roots: StructuralNode[];
};

/** The step of Playwright's selector that goes into a frame. */
const ENTERS_FRAME = "internal:control=enter-frame";

/**
 * The documents of a snapshot an input may have been given to, from what its
 * report says of where it happened. Playwright's selector names every frame
 * it enters on its way to the target, so it says how deep in frames the
 * target is: not at all for the page, which is then the one document; once
 * for a frame of the page, and so on, which leaves every frame that deep.
 * None for a report with no selector: nothing says where the input happened.
 */
export function scopesFor(
  tree: StructuralTree,
  selector: string | null
): Scope[] {
  if (selector === null) return [];
  const deep = selector
    .split(" >> ")
    .filter((step) => step === ENTERS_FRAME).length;
  if (deep === 0) return [{ frame: null, roots: tree.getRootNodes() }];
  const frames: StructuralNode[] = [];
  tree.walk((node) => {
    const around = tree
      .getAncestorsOf(node.ref)
      .filter((ancestor) => ancestor.role === "iframe").length;
    if (node.role === "iframe" && around === deep - 1) frames.push(node);
  });
  return frames.map((frame) => ({ frame, roots: nodes(frame) }));
}

/** Whether a picture's top level is that of a scope: the same roles and
 * names, in order. */
function fitsScope(
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
function namedInPicture(
  picture: StructuralTree,
  target: NonNullable<InteractionReport["target"]>
): AriaRef | undefined {
  // Stryker disable next-line ArrayDeclaration: equivalent, since a candidate that is no ref of the picture is passed over
  const ancestors = target.ancestors ?? [];
  for (const candidate of [target.ref, ...ancestors]) {
    // A target the picture does not list has no ref: null is no ref.
    const parsed = AriaRefSchema.safeParse(candidate);
    if (parsed.success && picture.hasNode(parsed.data)) return parsed.data;
  }
  return undefined;
}

/**
 * The ref, in a snapshot's tree, of the element a report names; undefined
 * when it is not known for certain.
 *
 * Playwright's recorder gives each report its own picture of the page, taken
 * at the moment of the Interaction and numbered by itself: a picture of the
 * one document the input was given to. For an input the gate held, the
 * snapshot taken just before it shows the same page, so the target is the
 * node at the same place in both, in a document the report's selector allows
 * and whose top level is the picture's. It is taken only when the two nodes
 * agree on role and name, and only when one document has it: a ref is
 * trusted, so the element of another document that looks like the target is
 * never written in its place.
 */
export function locateTarget(
  before: StructuralTree,
  report: InteractionReport
): AriaRef | undefined {
  const { target } = report;
  if (!target) return undefined;
  // A factory of its own: the picture is read only here.
  const picture = StructuralTree.fromAriaSnapshotYaml(
    target.tree,
    new SyntheticAriaRefFactory()
  );
  const ref = namedInPicture(picture, target);
  if (!ref) return undefined;
  // It is a ref of the picture: its node is there, and so is the way to it.
  const path = pathTo(picture.getRootNodes(), ref)!;
  const named = picture.getNode(ref)!;
  const found = scopesFor(before, report.selector).flatMap((scope) => {
    if (!fitsScope(picture.getRootNodes(), scope.roots)) return [];
    let level = scope.roots;
    let at: StructuralNode | undefined;
    for (const index of path) {
      at = level[index];
      if (!at) break;
      level = nodes(at);
    }
    return at?.role === named.role && at.name === named.name ? [at.ref] : [];
  });
  // Two frames that both have it: which one the input was given to cannot
  // be told.
  return found.length === 1 ? found[0] : undefined;
}
