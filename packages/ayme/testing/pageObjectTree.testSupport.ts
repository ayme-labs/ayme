import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import {
  elementText,
  type PageObjectTreeNode,
  type PageObjectTreeRead,
} from "../src/page-objects/domain";

type Child = PageObjectTreeNode["children"][number];

/**
 * A declared element child holding the elements a capture names by `refs`:
 * one ref for a single element, a list for a Locator collection.
 */
export type ElementsOf = (name: string, refs: string | string[]) => Child;

/**
 * A Page Object Tree read over a capture of the page `yaml` writes in aria
 * snapshot notation with refs, its element children made by `objects` from
 * that capture.
 */
export function treeRead(
  yaml: string,
  objects: (elements: ElementsOf) => PageObjectTreeNode[]
): PageObjectTreeRead {
  const tree = StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
  const elements: ElementsOf = (name, refs) => ({
    kind: "elements",
    name,
    collection: Array.isArray(refs),
    elements: [refs].flat().flatMap((ref) => {
      const text = elementText(tree, ref as AriaRef);
      return text ? [{ ref, text }] : [];
    }),
  });
  return { objects: objects(elements), tree };
}
