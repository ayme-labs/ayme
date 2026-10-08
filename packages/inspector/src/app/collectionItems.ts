import { type MemberIndex, pathBelowPage } from "../page-model";
import {
  type StructureNode,
  type StructureTree,
  structureRows,
} from "../structure";
import type { CollectionItem } from "../runs";

/**
 * A collection action's items on the page, by its tool's name, in page
 * order, labelled by what they show. An item with no ref in the page state
 * is left out.
 */
export function itemsOf(
  toolName: string,
  members: MemberIndex,
  structure: StructureTree
): CollectionItem[] {
  const rows = [...structureRows(structure.roots)];
  return members.collectionItems(toolName).flatMap((item) => {
    const node = rows.find(
      ({ node }) => node.ref !== undefined && node.members.includes(item.path)
    )?.node;
    return node?.ref === undefined
      ? []
      : [
          {
            path: item.path,
            name: item.name,
            pathBelowPage: pathBelowPage(item, members),
            ref: node.ref,
            label: textOf(node),
          },
        ];
  });
}

/** What a node shows: its name, or else its first text. */
function textOf(node: StructureNode | undefined): string {
  if (!node) return "";
  if (node.name) return node.name;
  for (const child of node.children) {
    const text = textOf(child);
    if (text) return text;
  }
  return "";
}
