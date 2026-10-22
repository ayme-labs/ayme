import {
  renderCompactStructuralNodeForest,
  projectStructuralNodeForest,
  type AriaRef,
  type ProjectedStructuralNode,
  type ProjectedStructuralNodeForest,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { pomLabelProjection, type PomLabels } from "./pomLabels";

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

/** One capture of the page: its tree, element map and Page Object labels. */
export type PageCapture = PageStateCapture & {
  /** The Page Object labels of the tree's Page Object Roots, by ref. */
  readonly pomLabels: PomLabels;
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
  pomLabels,
}: Pick<PageCapture, "tree" | "pomLabels">): RenderedPageState {
  const labels = pomLabelProjection(pomLabels);
  const projected = projectStructuralNodeForest(
    {
      roots: tree.getRootNodes(),
      structuralNode: labels.structuralNode,
      children: (node) => node.children,
    },
    {
      includeIdentity: false,
      includeStatus: false,
      prefixes: labels.prefixes,
      properties: labels.properties,
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
 * Whether two captures give the same nodes the same labels: each `after`
 * label is read on the `before` node `reconciled` matched it to.
 */
export function sameLabels(
  before: PomLabels,
  after: PomLabels,
  reconciled: StructuralTree
): boolean {
  const key = (labels: readonly string[]) => [...labels].sort().join("\n");
  return (
    before.size === after.size &&
    [...after].every(([ref, labels]) => {
      const beforeRef = reconciled.getBeforeNodeForAfterRef(ref)?.ref ?? ref;
      const beforeLabels = before.get(beforeRef);
      return beforeLabels !== undefined && key(beforeLabels) === key(labels);
    })
  );
}
