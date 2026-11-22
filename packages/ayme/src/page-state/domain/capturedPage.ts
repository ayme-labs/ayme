import {
  AriaRefSchema,
  syntheticRef,
  type AriaRef,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import type { Capture } from "../../shared";
import {
  parseCapturedTree,
  type SyntheticAriaRefAllocator,
} from "./capturedTree";
import type { PomRootMarks } from "./pomRootMarks";
import {
  placeCapturedRoots,
  type OmittedCapturedRoot,
} from "./pomRootPlacement";

/**
 * The synthetic refs a host's trees mint for themselves, such as reconcile's
 * replacement for a colliding ref: named apart from the `s_<n>` refs the
 * in-page module mints for Page Object Roots, so neither ever takes the
 * other's.
 */
export function treeRefAllocator(): SyntheticAriaRefAllocator {
  let count = 0;
  return { create: () => syntheticRef(`tree${++count}`) };
}

/**
 * The tree of a capture and the Page Object Root Marks of its roots: the
 * distilled text with excluded refs left out, each root placed and marked,
 * a root without a node of its own over the nodes inside it, under the
 * synthetic ref the module minted for it, and each element the capture
 * kept placed too.
 */
export function structureCapture(
  capture: Capture,
  refFactory: SyntheticAriaRefAllocator
): { tree: StructuralTree; pomRootMarks: PomRootMarks } {
  const excludedRefs = new Set(capture.excludedRefs.map(parseRef));
  const retainedTree = parseCapturedTree(
    capture.distilledText,
    refFactory,
    excludedRefs
  );
  const fullTree = parseCapturedTree(
    capture.fullText,
    refFactory,
    excludedRefs
  );
  const referenced = capture.roots.flatMap((root) =>
    "ref" in root ? [{ ref: parseRef(root.ref), labels: root.labels }] : []
  );
  const placement = placeCapturedRoots(
    retainedTree,
    fullTree,
    referenced.map(({ ref }) => ({ kind: "referenced", ref })),
    refFactory
  );
  let tree = placement.tree;
  const marksByRef = new Map<AriaRef, string[]>();
  for (const [index, ref] of placement.refs.entries())
    if (ref !== null) marksByRef.set(ref, referenced[index]!.labels);

  for (const root of capture.roots) {
    if (!("syntheticRef" in root)) continue;
    const omitted = placeCapturedRoots(
      tree,
      fullTree,
      [
        omittedCapturedRoot(
          parseRef(root.syntheticRef),
          root.descendantRefs.map(parseRef),
          tree,
          fullTree
        ),
      ],
      refFactory
    );
    tree = omitted.tree;
    const ref = omitted.refs[0] ?? null;
    if (ref !== null) marksByRef.set(ref, root.labels);
  }
  // The elements the capture kept as nodes of their own, which the distilled
  // text may show as their parent's text, placed from the full tree.
  if (capture.kept?.length)
    tree = placeCapturedRoots(
      tree,
      fullTree,
      capture.kept.map((ref) => ({ kind: "referenced", ref: parseRef(ref) })),
      refFactory
    ).tree;
  return { tree, pomRootMarks: marksByRef };
}

const parseRef = (ref: string): AriaRef => AriaRefSchema.parse(ref);

/**
 * A root without a node of its own, over the nodes inside it that `tree`
 * shows, in the full tree's order, under their nearest common ancestor.
 */
function omittedCapturedRoot(
  ref: AriaRef,
  inside: readonly AriaRef[],
  tree: StructuralTree,
  fullTree: StructuralTree
): OmittedCapturedRoot {
  const fullOrder = new Map(
    fullTree.getAllRefs().map((candidate, index) => [candidate, index] as const)
  );
  const order = (candidate: AriaRef) =>
    fullOrder.get(candidate) ?? Number.MAX_SAFE_INTEGER;
  const descendantRefs = inside
    .filter((candidate) => tree.hasNode(candidate))
    .sort((left, right) => order(left) - order(right));
  const ancestorRef = descendantRefs[0]
    ? tree
        .getAncestorsOf(descendantRefs[0])
        .find((ancestor) =>
          descendantRefs.every((descendant) =>
            tree
              .getAncestorsOf(descendant)
              .some((candidate) => candidate.ref === ancestor.ref)
          )
        )?.ref
    : undefined;
  return {
    kind: "omitted",
    ref,
    ancestorRef,
    descendantRefs,
    role: "generic",
    name: "",
  };
}
