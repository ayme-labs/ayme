import {
  renderCompactStructuralNodeForest,
  projectStructuralNodeForest,
  type AriaRef,
  type ProjectedStructuralNode,
  type ProjectedStructuralNodeForest,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { pomRootMarkProjection, type PomRootMarks } from "./pomRootMarks";

export type { AriaRef };

export type AymeNode = {
  ref: AriaRef;
  element: Element;
};

export type RefResolution =
  | {
      status: "resolved";
      requestedRef: AriaRef;
      node: AymeNode;
    }
  | {
      status: "unresolved";
      requestedRef: AriaRef;
      /**
       * `unknown-ref`, `removed` and `ambiguous` come from the identity ledger
       * (see `StructuralIdentityResolution`). `no-element`: the ref resolved to a
       * current ref, but the latest capture holds no live element for it.
       */
      reason: "unknown-ref" | "removed" | "ambiguous" | "no-element";
    };

export type PageState = {
  readonly text: string;
  resolve(...refs: AriaRef[]): Promise<RefResolution[]>;
};

/** Package-internal: typed data from the latest Page State Session capture. */
export type PageStateCapture = {
  readonly tree: StructuralTree;
  readonly elementsByRef: ReadonlyMap<AriaRef, Element>;
};

/** One capture of the page: its tree, element map and Page Object Root Marks. */
export type PageCapture = PageStateCapture & {
  /** The Page Object Root Marks of the tree's Page Object Roots, by ref. */
  readonly pomRootMarks: PomRootMarks;
};

/** A capture as the model is shown it. */
export type RenderedPageState = {
  readonly text: string;
  /** The projected forest `text` is rendered from: what the model is shown. */
  readonly projected: ProjectedStructuralNodeForest;
};

/**
 * A capture that recorded nothing: its tree, element map, rendered text and
 * the projected forest the text is rendered from.
 */
export type PageStateLook = PageStateCapture & RenderedPageState;

/** The page state text of a capture, and the projected forest it renders. */
export function renderPageState({
  tree,
  pomRootMarks,
}: Pick<PageCapture, "tree" | "pomRootMarks">): RenderedPageState {
  const marks = pomRootMarkProjection(pomRootMarks);
  const projected = projectStructuralNodeForest(
    {
      roots: tree.getRootNodes(),
      structuralNode: marks.structuralNode,
      children: (node) => node.children,
    },
    {
      includeIdentity: false,
      includeStatus: false,
      prefixes: marks.prefixes,
      properties: marks.properties,
    }
  );
  return { text: renderCompactStructuralNodeForest(projected), projected };
}

/**
 * Package-internal: a projected node's own entry in the page state text, as
 * the text renders it: its lines (its line, then its properties, without the
 * entries nested under it) and how many entries nest under it.
 */
export function pageStateNodeEntry(node: ProjectedStructuralNode): {
  lines: string[];
  childCount: number;
} {
  const lines = renderCompactStructuralNodeForest({ roots: [node] }).split(
    "\n"
  );
  return {
    lines: lines.slice(0, 1 + node.properties.length),
    // A node rendered on one line has its one text, if any, on that line.
    childCount: lines.length === 1 ? 0 : node.children.length,
  };
}

/**
 * Whether two captures give the same nodes the same marks: each `after`
 * mark is read on the `before` node `reconciled` matched it to.
 */
export function sameRootMarks(
  before: PomRootMarks,
  after: PomRootMarks,
  reconciled: StructuralTree
): boolean {
  const key = (marks: readonly string[]) => [...marks].sort().join("\n");
  return (
    before.size === after.size &&
    [...after].every(([ref, marks]) => {
      const beforeRef = reconciled.getBeforeNodeForAfterRef(ref)?.ref ?? ref;
      const beforeMarks = before.get(beforeRef);
      return beforeMarks !== undefined && key(beforeMarks) === key(marks);
    })
  );
}
