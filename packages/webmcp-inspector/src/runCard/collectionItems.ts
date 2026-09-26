import type { StructureNode } from "../adapter/structure";
import type { CollectionItem } from "../adapter/useRuns";

/**
 * The items on the page a collection action can run on, in page order: the
 * structure nodes whose member is an item at the collection's path.
 *
 * @param collection where the items are, e.g. "ListPage.items[]".
 */
export function collectionItems(
  collection: string,
  roots: readonly StructureNode[]
): CollectionItem[] {
  const pattern = new RegExp(
    `^${collection
      .split("[]")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\[\\d+\\]")}$`
  );
  const items: CollectionItem[] = [];
  const visit = (nodes: readonly StructureNode[]) => {
    for (const node of nodes) {
      if (node.ref !== undefined && node.member && pattern.test(node.member))
        items.push({ path: node.member, ref: node.ref, label: textOf(node) });
      visit(node.children);
    }
  };
  visit(roots);
  return items;
}

/** What a node shows: its name, or else its first text. */
function textOf(node: StructureNode): string {
  if (node.name) return node.name;
  for (const child of node.children) {
    const text = textOf(child);
    if (text) return text;
  }
  return "";
}
