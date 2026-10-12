import type { CollectionToolItem } from "@ayme-dev/ayme/internal";

import { type MemberIndex, pathBelowPage } from "../page-model";
import {
  type StructureNode,
  type StructureTree,
  structureRows,
} from "../structure";
import type { CollectionItem } from "../runs";

/**
 * A collection action's items on the page, by its tool's name, in page
 * order, labelled by what they show, each with the registry's `verdicts`
 * on whether the action would run on it. An item with no ref in the page
 * state is left out.
 */
export function itemsOf(
  toolName: string,
  members: MemberIndex,
  structure: StructureTree,
  verdicts: readonly CollectionToolItem[] = []
): CollectionItem[] {
  const rows = [...structureRows(structure.roots)];
  return members.collectionItems(toolName).flatMap((item) => {
    const node = rows.find(
      ({ node }) => node.ref !== undefined && node.members.includes(item.path)
    )?.node;
    const verdict = verdicts.find(({ label }) => label === item.path);
    return node?.ref === undefined
      ? []
      : [
          {
            path: item.path,
            name: item.name,
            pathBelowPage: pathBelowPage(item, members),
            ref: node.ref,
            label: textOf(node),
            ...(verdict && {
              available: verdict.available,
              ...(verdict.reason === undefined
                ? {}
                : { reason: verdict.reason }),
            }),
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
