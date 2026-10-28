import {
  isSyntheticRef,
  type AriaRef,
  type ProjectedStructuralProperty,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";

/** The Page Object Root Marks a page state capture gives each Page Object Root, by ref. */
export type PomRootMarks = ReadonlyMap<AriaRef, readonly string[]>;

/**
 * How a node's Page Object Root Marks show in the compact notation, the one rule
 * `snapshot` and the Change Record share: a single mark that is a class name
 * (`ListPage`, `ListItem`) is an inline prefix after the ref with the
 * role suppressed; several marks, or one that is not a class name, are the
 * `pom` property. A synthetic root, which has no role of its own, shows none.
 */
export function pomRootMarkProjection(marks: PomRootMarks) {
  const inlineMarks = new Map<AriaRef, string>();
  const properties = new Map<AriaRef, ProjectedStructuralProperty[]>();
  for (const [ref, refMarks] of marks) {
    const sorted = [...refMarks].sort();
    const value = sorted.length === 1 ? sorted[0]! : sorted;
    if (typeof value === "string" && /^[A-Za-z_$][\w$]*$/.test(value))
      inlineMarks.set(ref, value);
    else properties.set(ref, [{ key: "pom", label: "pom", value }]);
  }
  return {
    structuralNode: (node: StructuralNode): StructuralNode =>
      inlineMarks.has(node.ref) || isSyntheticRef(node.ref)
        ? node.copy({ role: "generic" })
        : node,
    prefixes: (node: StructuralNode): string[] => [
      node.ref,
      ...(inlineMarks.has(node.ref) ? [inlineMarks.get(node.ref)!] : []),
    ],
    properties: (node: StructuralNode): ProjectedStructuralProperty[] =>
      properties.get(node.ref) ?? [],
  };
}
