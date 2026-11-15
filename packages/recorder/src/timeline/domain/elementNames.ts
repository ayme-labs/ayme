import type {
  AriaRef,
  StructuralNode,
  StructuralTree,
} from "@ayme-dev/core/structural-observation";

// How whoever shows a recorder names an element of the page's structure:
// by its role and its name, as the released recorder's window did. The page
// as it is now can be asked for an element named so.

/** An element of a tree, as it is named. */
export type NamedElement = {
  /** Its ref in the tree it was read from. */
  readonly ref: AriaRef;
  readonly role: string;
  /** Its name; for an element with no name and nothing but text inside it,
   * that text, and `byText` says so. Empty for one named by its role only. */
  readonly name: string;
  readonly byText: boolean;
};

/** Roles that say nothing of an element. */
const NO_ROLE = new Set(["generic", "none", "presentation", "fragment"]);

/** An element by its own role and name, or by its text when it has no name
 * and nothing but text inside it; null for one with no role and no name. */
export function ownName(node: StructuralNode): NamedElement | null {
  const { ref, role } = node;
  if (node.name) return { ref, role, name: node.name, byText: false };
  const onlyText = node.children.every((child) => typeof child === "string");
  const text = onlyText ? node.children.join(" ") : "";
  if (text) return { ref, role, name: text, byText: true };
  return NO_ROLE.has(role) ? null : { ref, role, name: "", byText: false };
}

/** The named elements inside a node, the topmost of them, in order. */
export function namedInside(node: StructuralNode): NamedElement[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string") return [];
    const own = ownName(child);
    return own ? [own] : namedInside(child);
  });
}

/** An element by its own role and name, or else by its nearest ancestor
 * that has one; null when none has. */
export function namedNear(
  tree: StructuralTree,
  node: StructuralNode
): NamedElement | null {
  for (const one of [node, ...tree.getAncestorsOf(node.ref)]) {
    const own = ownName(one);
    if (own) return own;
  }
  return null;
}

/** An element in words: its role, unless it says nothing, and its name,
 * quoted; "element" for none. */
export function wordsOf(named: NamedElement | null): string {
  if (!named) return "element";
  const words = [
    ...(NO_ROLE.has(named.role) ? [] : [named.role]),
    ...(named.name ? [`"${escaped(named.name)}"`] : []),
  ];
  return words.join(" ");
}

const escaped = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
