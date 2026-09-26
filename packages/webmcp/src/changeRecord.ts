import {
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
  type StructuralNode,
  type StructuralTree,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";

/**
 * Render the changed subtrees of a reconciled structural tree
 * in the compact notation that get_page_context uses.
 *
 * Path nodes whose own content did not change, including nodes updated only
 * because their child list changed, are kept as plain structural markers
 * (role + name + ref) with their text children and unchanged branch children
 * stripped. Added and removed subtrees appear in full (the reconciler marks
 * every descendant). Nodes whose own content changed show their text content;
 * unchanged structural children below them are pruned.
 */
export function renderChangeRecord(reconciled: StructuralTree): string {
  const changed = new Set<AriaRef>();
  const contentChanged = new Set<AriaRef>();
  reconciled.walk((node) => {
    const status = node.status;
    if (status === undefined || status.kind === "unchanged") return;
    changed.add(node.ref);
    if (status.kind !== "updated" || status.selfChanged)
      contentChanged.add(node.ref);
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

  const projected = projectStructuralNodeForest(
    {
      roots: reconciled.getRootNodes().filter(hasChangeBelow),
      structuralNode: (node) => node,
      children: (node) => {
        const showsText = contentChanged.has(node.ref);
        return node.children.filter((child) =>
          typeof child === "string" ? showsText : hasChangeBelow(child)
        );
      },
    },
    {
      includeIdentity: false,
      includeStatus: true,
      prefixes: (node) => [node.ref],
    }
  );

  return renderCompactStructuralNodeForest(projected);
}
