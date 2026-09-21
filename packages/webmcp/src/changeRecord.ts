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
 * Unchanged path nodes are kept as structural markers (role + name + ref)
 * but their text children and unchanged branch children are stripped.
 * Added and removed subtrees appear in full (the reconciler marks every
 * descendant). Updated nodes show their text content; unchanged structural
 * children below them are pruned.
 */
export function renderChangeRecord(reconciled: StructuralTree): string {
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

  const projected = projectStructuralNodeForest(
    {
      roots: reconciled.getRootNodes().filter(hasChangeBelow),
      structuralNode: (node) => node,
      children: (node) => {
        const isChanged = changed.has(node.ref);
        return node.children.filter((child) =>
          typeof child === "string" ? isChanged : hasChangeBelow(child)
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
