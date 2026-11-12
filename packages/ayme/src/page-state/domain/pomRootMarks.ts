import {
  isSyntheticRef,
  type AriaRef,
  type ProjectedStructuralProperty,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";

/** The Page Object Root Marks a page state capture gives each Page Object Root, by ref. */
export type PomRootMarks = ReadonlyMap<AriaRef, readonly string[]>;

/**
 * What a page state text prints on a Page Object Root beside its marks, by
 * ref: the id of its Page Object. The Page Object module gives the ids; here
 * they are text.
 */
export type PomRootIds = ReadonlyMap<AriaRef, string>;

/**
 * How a node's Page Object Root Marks show in the compact notation, the one rule
 * `snapshot` and the Change Record share: a single mark that is a class name
 * (`ListPage`, `ListItem`) is an inline prefix after the ref with the
 * role suppressed; several marks, or one that is not a class name, are the
 * `pom` property. A synthetic root, which has no role of its own, shows none.
 * A root with an id in `ids` shows it beside its marks: after an inline
 * class name, or else as the `id` property.
 */
export function pomRootMarkProjection(
  marks: PomRootMarks,
  ids: PomRootIds = new Map()
) {
  const inlineMarks = new Map<AriaRef, string[]>();
  const properties = new Map<AriaRef, ProjectedStructuralProperty[]>();
  for (const [ref, refMarks] of marks) {
    const sorted = [...refMarks].sort();
    const value = sorted.length === 1 ? sorted[0]! : sorted;
    const id = ids.get(ref);
    if (typeof value === "string" && /^[A-Za-z_$][\w$]*$/.test(value))
      inlineMarks.set(ref, id === undefined ? [value] : [value, id]);
    else
      properties.set(ref, [
        { key: "pom", label: "pom", value },
        ...(id === undefined ? [] : [{ key: "id", label: "id", value: id }]),
      ]);
  }
  return {
    structuralNode: (node: StructuralNode): StructuralNode =>
      inlineMarks.has(node.ref) || isSyntheticRef(node.ref)
        ? node.copy({ role: "generic" })
        : node,
    prefixes: (node: StructuralNode): string[] => [
      node.ref,
      ...(inlineMarks.get(node.ref) ?? []),
    ],
    properties: (node: StructuralNode): ProjectedStructuralProperty[] =>
      properties.get(node.ref) ?? [],
  };
}
