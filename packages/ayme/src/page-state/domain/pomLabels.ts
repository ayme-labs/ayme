import {
  isSyntheticRef,
  type AriaRef,
  type ProjectedStructuralProperty,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";

/** The Page Object labels a page state capture gives each Page Object Root, by ref. */
export type PomLabels = ReadonlyMap<AriaRef, readonly string[]>;

/**
 * How a node's Page Object labels show in the compact notation, the one rule
 * `snapshot` and the Change Record share: a single label that is a class name
 * (`ListPage`, `ListItem`) is an inline prefix after the ref with the
 * role suppressed; several labels, or one that is not a class name, are the
 * `pom` property. A synthetic root, which has no role of its own, shows none.
 */
export function pomLabelProjection(labels: PomLabels) {
  const inlineLabels = new Map<AriaRef, string>();
  const properties = new Map<AriaRef, ProjectedStructuralProperty[]>();
  for (const [ref, refLabels] of labels) {
    const sorted = [...refLabels].sort();
    const value = sorted.length === 1 ? sorted[0]! : sorted;
    if (typeof value === "string" && /^[A-Za-z_$][\w$]*$/.test(value))
      inlineLabels.set(ref, value);
    else properties.set(ref, [{ key: "pom", label: "pom", value }]);
  }
  return {
    structuralNode: (node: StructuralNode): StructuralNode =>
      inlineLabels.has(node.ref) || isSyntheticRef(node.ref)
        ? node.copy({ role: "generic" })
        : node,
    prefixes: (node: StructuralNode): string[] => [
      node.ref,
      ...(inlineLabels.has(node.ref) ? [inlineLabels.get(node.ref)!] : []),
    ],
    properties: (node: StructuralNode): ProjectedStructuralProperty[] =>
      properties.get(node.ref) ?? [],
  };
}
