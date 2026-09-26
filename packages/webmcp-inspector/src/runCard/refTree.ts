import type { StructureNode } from "../adapter/structure";

/** A node a ref field can choose: one that carries a ref. */
export type RefNode = StructureNode & { ref: string };

/** Whether a tool can use a node. */
export type CanUseNode = (node: RefNode) => boolean;

/** A row of the ref field's tree. */
export type RefTreeRow = {
  node: RefNode;
  /** Its depth among the rows, from a root. */
  depth: number;
  /**
   * What it shows besides its name: its text, for a node without a name,
   * e.g. a list item that reads "Milk".
   */
  text: string;
  /** Whether it matches the search. The ancestors of a match don't. */
  match: boolean;
  /** Whether the tool can use it. A node it can't use can't be chosen. */
  usable: boolean;
};

/**
 * The rows of the ref field's tree, depth first: the nodes with a ref that
 * match the search, each with its ancestors, so the tree still reads as a
 * tree. Text has no ref and isn't a row; it counts as its parent's.
 *
 * A node matches when every word of the query is in its ref, role, quoted
 * name or text, ignoring case. An empty query matches every node.
 */
export function refTreeRows(
  roots: readonly StructureNode[],
  { query = "", canUse = () => true }: { query?: string; canUse?: CanUseNode }
): RefTreeRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows: RefTreeRow[] = [];

  /** Adds the subtree's rows; true when it holds a match. */
  const visit = (nodes: readonly StructureNode[], depth: number): boolean => {
    let found = false;
    for (const node of nodes) {
      if (node.ref === undefined) {
        // An element without a ref: its children take its place.
        found = visit(node.children, depth) || found;
        continue;
      }
      const refNode = node as RefNode;
      const text = node.name ? "" : textOf(node);
      const haystack =
        `${node.ref} ${node.role} "${node.name}" ${text}`.toLowerCase();
      const row: RefTreeRow = {
        node: refNode,
        depth,
        text,
        match: words.every((word) => haystack.includes(word)),
        usable: canUse(refNode),
      };
      const at = rows.length;
      rows.push(row);
      const below = visit(node.children, depth + 1);
      // Neither a match nor above one: it isn't shown.
      if (!row.match && !below) rows.splice(at, rows.length - at);
      else found = true;
    }
    return found;
  };

  visit(roots, 0);
  return rows;
}

/** The text a node shows through its text children. */
function textOf(node: StructureNode): string {
  return node.children
    .filter((child) => child.role === "text" && child.ref === undefined)
    .map((child) => child.name)
    .join(" ");
}
