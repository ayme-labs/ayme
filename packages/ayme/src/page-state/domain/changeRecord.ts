import {
  isSyntheticRef,
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
  type StructuralNode,
  type StructuralTree,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { pomRootMarkProjection, type PomRootMarks } from "./pomRootMarks";

/** The Page Object Root Marks of the two observations a Change Record reads between. */
export type ChangeRecordRootMarks = {
  readonly before: PomRootMarks;
  readonly after: PomRootMarks;
};

const noRootMarks: ChangeRecordRootMarks = {
  before: new Map(),
  after: new Map(),
};

/**
 * Render the changed subtrees of a reconciled structural tree
 * in the compact notation that snapshot uses.
 *
 * Path nodes whose own content did not change, including nodes updated only
 * because their child list changed, are kept as plain structural markers
 * (role + name + ref) with their text children and unchanged branch children
 * stripped. Added and removed subtrees appear in full (the reconciler marks
 * every descendant). Nodes whose own content changed show their text content;
 * unchanged structural children below them are pruned.
 *
 * A Page Object Root reads as `snapshot` shows it, marked by the side it
 * is read from: a removed node by the marks it had before, every other node
 * by the marks it has after.
 */
export function renderChangeRecord(
  reconciled: StructuralTree,
  marks: ChangeRecordRootMarks = noRootMarks
): string {
  const changed = new Set<AriaRef>();
  reconciled.walk((node) => {
    if (
      node.status?.kind === "added" ||
      node.status?.kind === "removed" ||
      node.status?.kind === "updated"
    )
      changed.add(node.ref);
  });

  if (changed.size === 0) return "";

  const cache = new Map<AriaRef, boolean>();
  const hasChangeBelow = (node: StructuralNode): boolean => {
    const cached = cache.get(node.ref);
    if (cached !== undefined) return cached;
    const result =
      changed.has(node.ref) ||
      node.children.some(
        (child) => typeof child !== "string" && hasChangeBelow(child)
      );
    cache.set(node.ref, result);
    return result;
  };

  const before = pomRootMarkProjection(marks.before);
  const after = pomRootMarkProjection(
    reconciledRootMarks(reconciled, marks.after)
  );
  const sideOf = (node: StructuralNode) =>
    node.status?.kind === "removed" ? before : after;

  const projected = projectStructuralNodeForest(
    {
      roots: reconciled.getRootNodes().filter(hasChangeBelow),
      structuralNode: (node) => sideOf(node).structuralNode(node),
      children: (node) => {
        const status = node.status;
        const withText =
          status?.kind === "added" ||
          status?.kind === "removed" ||
          (status?.kind === "updated" && status.selfChanged);
        return node.children.filter((child) =>
          typeof child === "string" ? withText : hasChangeBelow(child)
        );
      },
    },
    {
      includeIdentity: false,
      includeStatus: true,
      prefixes: (node) => sideOf(node).prefixes(node),
      properties: (node) => sideOf(node).properties(node),
    }
  );

  return renderCompactStructuralNodeForest(projected);
}

/**
 * The after side's marks by the refs the reconciled tree uses: a synthetic
 * root matched to a synthetic root before keeps its before ref there.
 */
function reconciledRootMarks(
  reconciled: StructuralTree,
  after: PomRootMarks
): PomRootMarks {
  return new Map(
    [...after].map(([ref, refMarks]) => {
      const before = isSyntheticRef(ref)
        ? reconciled.getBeforeNodeForAfterRef(ref)?.ref
        : undefined;
      return [
        before !== undefined && isSyntheticRef(before) ? before : ref,
        refMarks,
      ] as const;
    })
  );
}
