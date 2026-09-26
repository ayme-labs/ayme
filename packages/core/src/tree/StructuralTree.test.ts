import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineStructuralEnrichment } from "./StructuralEnrichment";
import { AriaRefSchema, type AriaRef } from "./StructuralTypes";
import { StructuralNode } from "./StructuralNode";
import { StructuralTree } from "./StructuralTree";
import { SyntheticAriaRefFactory } from "./SyntheticAriaRefFactory";

function parse(yaml: string): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
}

function parsePair(
  beforeYaml: string,
  afterYaml: string
): [StructuralTree, StructuralTree] {
  const factory = new SyntheticAriaRefFactory();
  return [
    StructuralTree.fromAriaSnapshotYaml(beforeYaml, factory),
    StructuralTree.fromAriaSnapshotYaml(afterYaml, factory),
  ];
}

function id(value: string): AriaRef {
  return AriaRefSchema.parse(value);
}

function ids(nodes: readonly StructuralNode[]): string[] {
  return nodes.map((node) => String(node.ref));
}
function ref(value: string): AriaRef {
  return AriaRefSchema.parse(value);
}

function expectNode(
  child: StructuralNode | string | undefined
): StructuralNode {
  expect(child).toBeDefined();
  expect(typeof child).not.toBe("string");
  return child as StructuralNode;
}

const testEnrichment = defineStructuralEnrichment({
  key: "test",
  schema: z.object({ labels: z.array(z.string()), markup: z.string() }),
  properties: {
    labels: (value) => value.labels,
    markup: (value) => value.markup,
  },
  hasChanged: () => false,
});

type TestEnrichment = z.infer<typeof testEnrichment.schema>;

const enrichmentA: TestEnrichment = {
  labels: ["create"],
  markup: "<button>Create</button>",
};

const enrichmentB: TestEnrichment = {
  labels: ["create-by-id"],
  markup: '<button class="x">Create</button>',
};

function enrichBy(
  tree: StructuralTree,
  byRef: Record<string, TestEnrichment>
): StructuralTree {
  const attach = (node: StructuralNode): StructuralNode => {
    const children = node.children.map((child) =>
      typeof child === "string" ? child : attach(child)
    );
    const rebuilt = node.copy({ children });
    const enrichment = byRef[node.ref];
    return enrichment === undefined
      ? rebuilt
      : rebuilt.attachEnrichment(testEnrichment, enrichment);
  };
  return new StructuralTree(attach(tree.root), new SyntheticAriaRefFactory());
}

describe("StructuralTree YAML keys", () => {
  it("parses a node line whose whole key Playwright single-quoted", () => {
    const tree = parse(
      `- list [ref=e1]:\n  - 'button "Issue #123 it''s done" [ref=e2] [cursor=pointer]':\n    - text: x`
    );
    const node = tree.getNode(id("e2"))!;
    expect(node.role).toBe("button");
    expect(node.name).toBe("Issue #123 it's done");
    expect(node.cursorPointer).toBe(true);
    expect(node.children).toEqual(["x"]);
  });

  it("parses a single-quoted leaf node line, which has no trailing colon", () => {
    const tree = parse(
      `- list [ref=e1]:\n  - 'button "Issue #123" [ref=e2]'\n  - 'link "it''s #1" [ref=e3]'`
    );
    const button = tree.getNode(id("e2"))!;
    expect(button.role).toBe("button");
    expect(button.name).toBe("Issue #123");
    expect(button.children).toEqual([]);
    const link = tree.getNode(id("e3"))!;
    expect(link.role).toBe("link");
    expect(link.name).toBe("it's #1");
    expect(link.children).toEqual([]);
  });
});

describe("StructuralTree navigation", () => {
  const NESTED = `
- generic [ref=e1]:
  - list [ref=e2]:
    - listitem [ref=e3]
  - button "Shared" [ref=e4]
`.trim();

  const MULTI_ROOT = `
- button "A" [ref=e1]
- button "B" [ref=e2]
`.trim();

  describe("getNode / hasNode", () => {
    it("returns the node for a known id", () => {
      const tree = parse(NESTED);

      const node = tree.getNode(ref("e3"));

      expect(node).not.toBeNull();
      expect(node?.role).toBe("listitem");
    });

    it("returns null for an unknown id", () => {
      const tree = parse(NESTED);

      expect(tree.getNode(id("s_999"))).toBeNull();
    });

    it("reports presence via hasNode", () => {
      const tree = parse(NESTED);

      expect(tree.hasNode(ref("e1"))).toBe(true);
      expect(tree.hasNode(id("s_999"))).toBe(false);
    });
  });

  describe("canonical ordering", () => {
    it("returns ids in preorder", () => {
      const tree = parse(NESTED);

      expect(tree.getAllRefs().map(String)).toEqual(["e1", "e2", "e3", "e4"]);
    });

    it("returns nodes in the same preorder as ids", () => {
      const tree = parse(NESTED);

      expect(ids(tree.getAllNodes())).toEqual(tree.getAllRefs().map(String));
    });

    it("walks in the same order as getAllNodes", () => {
      const tree = parse(NESTED);

      const walked: string[] = [];
      tree.walk((node) => walked.push(String(node.ref)));

      expect(walked).toEqual(ids(tree.getAllNodes()));
    });
  });

  describe("root handling", () => {
    it("returns the single semantic root", () => {
      const tree = parse(NESTED);

      expect(ids(tree.getRootNodes())).toEqual(["e1"]);
    });

    it("returns semantic roots for multi-root input and hides the synthetic fragment", () => {
      const tree = parse(MULTI_ROOT);

      expect(ids(tree.getRootNodes())).toEqual(["e1", "e2"]);
      expect(tree.getAllRefs().map(String)).toEqual(["e1", "e2"]);
      expect(tree.hasNode(id("s_root"))).toBe(false);
      expect(tree.getNode(id("s_root"))).toBeNull();
    });
  });

  describe("ancestry", () => {
    it("returns the direct parent", () => {
      const tree = parse(NESTED);

      expect(tree.getParentOf(ref("e3"))?.ref).toBe(ref("e2"));
    });

    it("returns null parent for a semantic root", () => {
      const tree = parse(NESTED);

      expect(tree.getParentOf(ref("e1"))).toBeNull();
    });

    it("returns null parent for semantic roots under a synthetic fragment", () => {
      const tree = parse(MULTI_ROOT);

      expect(tree.getParentOf(ref("e1"))).toBeNull();
      expect(tree.getParentOf(ref("e2"))).toBeNull();
    });

    it("returns ancestors nearest-first up to the root", () => {
      const tree = parse(NESTED);

      expect(ids(tree.getAncestorsOf(ref("e3")))).toEqual(["e2", "e1"]);
    });

    it("returns an empty ancestor chain for a root", () => {
      const tree = parse(NESTED);

      expect(tree.getAncestorsOf(ref("e1"))).toEqual([]);
    });

    it("reports depth starting at 0 for roots", () => {
      const tree = parse(NESTED);

      expect(tree.getDepthOf(ref("e1"))).toBe(0);
      expect(tree.getDepthOf(ref("e2"))).toBe(1);
      expect(tree.getDepthOf(ref("e3"))).toBe(2);
    });

    it("returns null depth for an unknown id", () => {
      const tree = parse(NESTED);

      expect(tree.getDepthOf(id("s_999"))).toBeNull();
    });
  });

  describe("reconciled trees", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - button "Old" [ref=e2]
  - button "Shared" [ref=e3]
`.trim(),
      `
- generic [ref=e4]:
  - button "Shared" [ref=e5]
  - button "New" [ref=e6]
`.trim()
    );

    it("keeps added, changed, and removed nodes addressable", () => {
      const reconciled = StructuralTree.reconcile(before, after);

      expect(reconciled.getNode(ref("e2"))?.name).toBe("Old");
      expect(reconciled.getNode(ref("e2"))?.status).toEqual({
        kind: "removed",
      });
      expect(reconciled.getNode(ref("e5"))?.name).toBe("Shared");
      expect(reconciled.getNode(ref("e6"))?.name).toBe("New");
      expect(reconciled.getNode(ref("e6"))?.status).toEqual({ kind: "added" });
    });

    it.each([
      [
        "removes a child while preserving the surviving order",
        '- generic [ref=e1]:\n  - button "First" [ref=e2]\n  - button "Remove" [ref=e3]\n  - button "Last" [ref=e4]',
        '- generic [ref=e1]:\n  - button "First" [ref=e2]\n  - button "Last" [ref=e4]',
        false,
      ],
      [
        "adds a child",
        '- generic [ref=e1]:\n  - button "First" [ref=e2]\n  - button "Last" [ref=e4]',
        '- generic [ref=e1]:\n  - button "First" [ref=e2]\n  - button "Added" [ref=e3]\n  - button "Last" [ref=e4]',
        true,
      ],
      [
        "reorders surviving children",
        '- generic [ref=e1]:\n  - button "First" [ref=e2]\n  - button "Second" [ref=e3]\n  - button "Last" [ref=e4]',
        '- generic [ref=e1]:\n  - button "Last" [ref=e4]\n  - button "First" [ref=e2]\n  - button "Second" [ref=e3]',
        true,
      ],
    ])(
      "marks the child list order-relevant when it %s",
      (_description, beforeYaml, afterYaml, expected) => {
        const [beforeTree, afterTree] = parsePair(beforeYaml, afterYaml);

        const reconciled = StructuralTree.reconcile(beforeTree, afterTree);

        expect(reconciled.getNode(ref("e1"))?.childListOrderRelevant).toBe(
          expected
        );
      }
    );

    it("exposes navigation over the reconciled structure", () => {
      const reconciled = StructuralTree.reconcile(before, after);

      expect(reconciled.getAllRefs().map(String)).toEqual([
        "e4",
        "e2",
        "e5",
        "e6",
      ]);
      expect(reconciled.getParentOf(ref("e6"))?.ref).toBe(ref("e4"));
      expect(ids(reconciled.getAncestorsOf(ref("e2")))).toEqual(["e4"]);
      expect(reconciled.getDepthOf(ref("e6"))).toBe(1);
    });
  });
});
describe("StructuralTree.getNode", () => {
  const NESTED = `
- generic [ref=e1]:
  - list [ref=e2]:
    - listitem [ref=e3]
  - button "Shared" [ref=e4]
`.trim();

  describe("parsed trees", () => {
    it("returns the node carrying the given aria ref", () => {
      const tree = parse(NESTED);

      const node = tree.getNode(ref("e3"));

      expect(node).not.toBeNull();
      expect(node?.role).toBe("listitem");
      expect(node?.ref).toBe(tree.getNode(node!.ref)?.ref);
    });

    it("returns null when no node carries the ref", () => {
      const tree = parse(NESTED);

      expect(tree.getNode(ref("e999"))).toBeNull();
    });
  });

  describe("reconciled trees", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - button "Old" [ref=e2]
  - button "Shared" [ref=e3]
`.trim(),
      `
- generic [ref=e4]:
  - button "Shared" [ref=e5]
  - button "New" [ref=e6]
`.trim()
    );

    it("resolves a surviving node by its current (after) ref", () => {
      const reconciled = StructuralTree.reconcile(before, after);

      const node = reconciled.getNode(ref("e5"));

      expect(node?.name).toBe("Shared");
      expect(node?.status?.kind).not.toBe("removed");
    });

    it("resolves an added node by its ref", () => {
      const reconciled = StructuralTree.reconcile(before, after);

      const node = reconciled.getNode(ref("e6"));

      expect(node?.name).toBe("New");
      expect(node?.status).toEqual({ kind: "added" });
    });

    it("still resolves a disappeared target via the retained removed node", () => {
      const reconciled = StructuralTree.reconcile(before, after);

      const node = reconciled.getNode(ref("e2"));

      expect(node?.name).toBe("Old");
      expect(node?.status).toEqual({ kind: "removed" });
    });

    it("returns null for a before-side ref that was replaced on a surviving node", () => {
      const reconciled = StructuralTree.reconcile(before, after);

      expect(reconciled.getNode(ref("e3"))).toBeNull();
    });
  });
});

describe("StructuralTree.reconcile aria-ref identity", () => {
  describe("name-presence transitions", () => {
    it("reconciles a re-reffed container that gains a name when its child subtree is unchanged", () => {
      const [before, after] = parsePair(
        `
- generic [ref=e1]:
  - generic [ref=e2]:
    - img [ref=e3]
    - generic [ref=e4]: Legend marker
`.trim(),
        `
- generic [ref=e1]:
  - generic "Renewing" [ref=e5]:
    - img [ref=e6]
    - generic [ref=e7]: Legend marker
`.trim()
      );

      const reconciled = StructuralTree.reconcile(before, after);

      expect(reconciled.getNodesByStatus("added")).toEqual([]);
      expect(reconciled.getNodesByStatus("removed")).toEqual([]);
      expect(reconciled.getNode(ref("e5"))?.ref).toBe(ref("e5"));
      expect(reconciled.getNode(ref("e5"))?.status).toEqual({
        kind: "updated",
        selfChanged: true,
        childListChanged: false,
      });
    });

    it("reconciles a re-reffed container that loses a name when its child subtree is unchanged", () => {
      const [before, after] = parsePair(
        `
- generic [ref=e1]:
  - generic "Renewing" [ref=e2]:
    - img [ref=e3]
    - generic [ref=e4]: Legend marker
`.trim(),
        `
- generic [ref=e1]:
  - generic [ref=e5]:
    - img [ref=e6]
    - generic [ref=e7]: Legend marker
`.trim()
      );

      const reconciled = StructuralTree.reconcile(before, after);

      expect(reconciled.getNodesByStatus("added")).toEqual([]);
      expect(reconciled.getNodesByStatus("removed")).toEqual([]);
      expect(reconciled.getNode(ref("e5"))?.ref).toBe(ref("e5"));
      expect(reconciled.getNode(ref("e5"))?.status).toEqual({
        kind: "updated",
        selfChanged: true,
        childListChanged: false,
      });
    });

    it("keeps a re-reffed non-empty name change as add/remove despite an unchanged child subtree", () => {
      const [before, after] = parsePair(
        `
- generic [ref=e1]:
  - generic "Renewing" [ref=e2]:
    - img [ref=e3]
`.trim(),
        `
- generic [ref=e1]:
  - generic "Expiring" [ref=e4]:
    - img [ref=e5]
`.trim()
      );

      const reconciled = StructuralTree.reconcile(before, after);

      expect(
        reconciled.getNodesByStatus("removed").map((node) => node.name)
      ).toContain("Renewing");
      expect(
        reconciled.getNodesByStatus("added").map((node) => node.name)
      ).toContain("Expiring");
    });

    it("does not reconcile ambiguous or childless name-presence transitions", () => {
      const [ambiguousBefore, ambiguousAfter] = parsePair(
        `
- generic [ref=e1]:
  - generic [ref=e2]:
    - img [ref=e3]
  - generic [ref=e4]:
    - img [ref=e5]
`.trim(),
        `
- generic [ref=e1]:
  - generic "Renewing" [ref=e6]:
    - img [ref=e7]
  - generic "Expiring" [ref=e8]:
    - img [ref=e9]
`.trim()
      );
      const [leafBefore, leafAfter] = parsePair(
        "- generic [ref=e1]:\n  - generic [ref=e2]",
        '- generic [ref=e1]:\n  - generic "Renewing" [ref=e3]'
      );

      const ambiguous = StructuralTree.reconcile(
        ambiguousBefore,
        ambiguousAfter
      );
      const childless = StructuralTree.reconcile(leafBefore, leafAfter);

      expect(
        ambiguous
          .getNodesByStatus("removed")
          .filter((node) => node.role === "generic")
          .map((node) => node.name)
      ).toEqual(["", ""]);
      expect(
        ambiguous
          .getNodesByStatus("added")
          .filter((node) => node.role === "generic")
          .map((node) => node.name)
      ).toEqual(["Renewing", "Expiring"]);
      expect(
        childless
          .getNodesByStatus("removed")
          .filter((node) => node.role === "generic")
          .map((node) => node.name)
      ).toEqual([""]);
      expect(
        childless
          .getNodesByStatus("added")
          .filter((node) => node.role === "generic")
          .map((node) => node.name)
      ).toEqual(["Renewing"]);
    });
  });
});

describe("StructuralTree status queries", () => {
  // The surviving generic and "Shared" button keep their aria refs across the visit (the new
  // identity model), so they reconcile in place; "Old" drops out and "New" arrives with a fresh ref.
  const [before, after] = parsePair(
    `
- generic [ref=e1]:
  - button "Old" [ref=e2]
  - button "Shared" [ref=e3]
`.trim(),
    `
- generic [ref=e1]:
  - button "Shared" [ref=e3]
  - button "New" [ref=e4]
`.trim()
  );

  it("returns nodes filtered by reconciliation status", () => {
    const reconciled = StructuralTree.reconcile(before, after);

    expect(
      reconciled.getNodesByStatus("added").map((node) => node.name)
    ).toEqual(["New"]);
    expect(
      reconciled.getNodesByStatus("removed").map((node) => node.name)
    ).toEqual(["Old"]);
    expect(
      reconciled.getNodesByStatus("updated").map((node) => node.role)
    ).toEqual(["generic"]);
    expect(
      reconciled.getNodesByStatus("unchanged").map((node) => node.name)
    ).toEqual(["Shared"]);
  });

  it("returns empty arrays for statuses absent from the tree", () => {
    const tree = parse('- button "Create" [ref=e1]');

    expect(tree.getNodesByStatus("added")).toEqual([]);
    expect(tree.getNodesByStatus("removed")).toEqual([]);
    expect(tree.getNodesByStatus("updated")).toEqual([]);
  });

  it("filters only top-level semantic roots by status", () => {
    const beforeRoots = parse(
      `
- button "A" [ref=e1]
- button "B" [ref=e2]
`.trim()
    );
    const afterRoots = parse(
      `
- button "A" [ref=e1]
- button "B" [ref=e2]
- button "New" [ref=e11]
`.trim()
    );
    const reconciled = StructuralTree.reconcile(beforeRoots, afterRoots);

    expect(
      reconciled.getTopLevelRootsByStatus("added").map((node) => node.name)
    ).toEqual(["New"]);
    expect(
      reconciled.getTopLevelRootsByStatus("unchanged").map((node) => node.name)
    ).toEqual(["A", "B"]);
    expect(reconciled.getTopLevelRootsByStatus("removed")).toEqual([]);
  });

  it("returns the outermost added/removed nodes, including ones nested under unchanged ancestors", () => {
    const [beforeNested, afterNested] = parsePair(
      `
- region "Body" [ref=e1]:
  - button "Stay" [ref=e2]
  - button "Old" [ref=e3]
`.trim(),
      `
- region "Body" [ref=e1]:
  - button "Stay" [ref=e2]
  - button "New" [ref=e4]
`.trim()
    );
    const reconciled = StructuralTree.reconcile(beforeNested, afterNested);

    // The region itself is only `updated`, so top-level-root filtering would miss
    // these nested changes; change roots surface them.
    expect(reconciled.getTopLevelRootsByStatus("added")).toEqual([]);
    expect(
      reconciled.getChangeRootsByStatus("added").map((node) => node.name)
    ).toEqual(["New"]);
    expect(
      reconciled.getChangeRootsByStatus("removed").map((node) => node.name)
    ).toEqual(["Old"]);
  });

  it("collapses an added/removed subtree to its topmost node", () => {
    const beforeSubtree = parse(
      `
- region "Body" [ref=e1]
- region "Sidebar" [ref=e5]
`.trim()
    );
    const afterSubtree = parse(
      `
- region "Body" [ref=e1]
- region "Sidebar" [ref=e5]
- dialog "Modal" [ref=e2]:
  - heading "Title" [ref=e3]
  - button "Close" [ref=e4]
`.trim()
    );
    const reconciled = StructuralTree.reconcile(beforeSubtree, afterSubtree);

    // Every node in the added dialog subtree is marked `added`, but only the
    // dialog (the topmost) is a change root.
    expect(
      reconciled.getNodesByStatus("added").map((node) => node.name)
    ).toEqual(["Modal", "Title", "Close"]);
    expect(
      reconciled.getChangeRootsByStatus("added").map((node) => node.name)
    ).toEqual(["Modal"]);
  });

  it("reports whether a reconciled tree carries any change", () => {
    const changed = StructuralTree.reconcile(before, after);
    const unchanged = StructuralTree.reconcile(
      parse('- button "Create" [ref=e1]'),
      parse('- button "Create" [ref=e1]')
    );

    expect(changed.hasAnyChanges()).toBe(true);
    expect(unchanged.hasAnyChanges()).toBe(false);
  });

  it("reports no changes on a freshly parsed (unreconciled) tree", () => {
    const tree = parse('- button "Create" [ref=e1]');

    expect(tree.hasAnyChanges()).toBe(false);
  });
});

describe("StructuralTree.reconcile enrichment", () => {
  it("carries current-side enrichment through reconciliation for kept nodes", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - button "Create" [ref=e2]
`.trim(),
      `
- generic [ref=e1]:
  - button "Create" [ref=e2] [disabled]
`.trim()
    );
    const enrichedBefore = enrichBy(before, { e2: enrichmentA });
    const enrichedAfter = enrichBy(after, { e2: enrichmentB });

    const reconciled = StructuralTree.reconcile(enrichedBefore, enrichedAfter);

    const button = reconciled.getNode(ref("e2"));
    expect(button!.status).toEqual({
      kind: "updated",
      selfChanged: true,
      childListChanged: false,
    });
    expect(button!.enrichmentValue(testEnrichment)).toEqual(enrichmentB);
  });

  it("keeps after-side enrichment on unchanged nodes", () => {
    const yaml = '- generic [ref=e1]:\n  - button "Create" [ref=e2]';
    const [before, after] = parsePair(yaml, yaml);
    const enrichedAfter = enrichBy(after, { e2: enrichmentB });

    const reconciled = StructuralTree.reconcile(before, enrichedAfter);

    const button = reconciled.getNode(ref("e2"));
    expect(button!.status).toEqual({ kind: "unchanged" });
    expect(button!.enrichmentValue(testEnrichment)).toEqual(enrichmentB);
  });

  it("retains before-side enrichment when a kept node has no current value for that kind", () => {
    const yaml = '- generic [ref=e1]:\n  - button "Create" [ref=e2]';
    const [before, after] = parsePair(yaml, yaml);
    const enrichedBefore = enrichBy(before, {
      e1: enrichmentA,
      e2: enrichmentA,
    });

    const reconciled = StructuralTree.reconcile(enrichedBefore, after);

    expect(
      reconciled.getNode(ref("e1"))!.enrichmentValue(testEnrichment)
    ).toEqual(enrichmentA);
    expect(
      reconciled.getNode(ref("e2"))!.enrichmentValue(testEnrichment)
    ).toEqual(enrichmentA);
  });

  it("keeps after-side enrichment on added nodes", () => {
    const [before, after] = parsePair(
      "- generic [ref=e1]",
      '- generic [ref=e1]:\n  - button "Create" [ref=e2]'
    );
    const enrichedAfter = enrichBy(after, { e2: enrichmentB });

    const reconciled = StructuralTree.reconcile(before, enrichedAfter);

    const button = reconciled.getNode(ref("e2"));
    expect(button!.status).toEqual({ kind: "added" });
    expect(button!.enrichmentValue(testEnrichment)).toEqual(enrichmentB);
  });

  it("keeps before-side enrichment on removed nodes", () => {
    const [before, after] = parsePair(
      '- generic [ref=e1]:\n  - button "Create" [ref=e2]',
      "- generic [ref=e1]"
    );
    const enrichedBefore = enrichBy(before, { e2: enrichmentA });

    const reconciled = StructuralTree.reconcile(enrichedBefore, after);

    const button = reconciled.getNode(ref("e2"));
    expect(button!.status).toEqual({ kind: "removed" });
    expect(button!.enrichmentValue(testEnrichment)).toEqual(enrichmentA);
  });
});

describe("StructuralTree.toCurrentTree", () => {
  const [before, after] = parsePair(
    `
- generic [ref=e1]:
  - button "Old" [ref=e2]
  - button "Shared" [ref=e3]
`.trim(),
    `
- generic [ref=e1]:
  - button "Shared" [ref=e3]
  - button "New" [ref=e6]
`.trim()
  );

  it("drops removed nodes from the projected tree", () => {
    const current = StructuralTree.reconcile(before, after).toCurrentTree();

    expect(current.getAllNodes().map((node) => node.name)).toEqual([
      "",
      "Shared",
      "New",
    ]);
    expect(current.getNode(ref("e2"))).toBeNull();
  });

  it("preserves reconciled refs for kept nodes", () => {
    const current = StructuralTree.reconcile(before, after).toCurrentTree();

    // matched/updated keep before-side ids; the added node keeps its globally-minted id.
    expect(ids(current.getAllNodes())).toEqual(["e1", "e3", "e6"]);
  });

  it("clears all reconciliation statuses", () => {
    const current = StructuralTree.reconcile(before, after).toCurrentTree();

    expect(current.hasAnyChanges()).toBe(false);
    expect(current.getNodesByStatus("added")).toEqual([]);
    expect(current.getNodesByStatus("updated")).toEqual([]);
    expect(current.getNodesByStatus("removed")).toEqual([]);
    expect(current.getNodesByStatus("unchanged")).toEqual([]);
    for (const node of current.getAllNodes())
      expect(node.status).toBeUndefined();
    expect(current.getNode(ref("e1"))?.childListOrderRelevant).toBe(false);
  });

  it("preserves current-side data for updated nodes", () => {
    const beforeState = parse('- textbox "Name" [ref=e1]');
    const afterState = parse('- textbox "Name" [disabled] [ref=e2]');

    const current = StructuralTree.reconcile(
      beforeState,
      afterState
    ).toCurrentTree();
    const textbox = expectNode(current.getRootNodes()[0]);

    expect(textbox.status).toBeUndefined();
    expect(textbox.state.disabled).toBe(true);
    expect(textbox.ref).toBe("e2");
  });

  it("preserves enrichment on kept nodes", () => {
    const reconciled = StructuralTree.reconcile(before, after);
    const enriched = enrichBy(
      reconciled,
      Object.fromEntries(
        reconciled.getAllNodes().map((node) => [node.ref, enrichmentA])
      )
    );

    const current = enriched.toCurrentTree();
    const generic = expectNode(current.getRootNodes()[0]);

    expect(generic.enrichmentValue(testEnrichment)).toEqual(enrichmentA);
  });

  it("keeps fragment roots while dropping removed top-level roots", () => {
    const beforeRoots = parse(
      `
- button "A" [ref=e1]
- button "B" [ref=e2]
`.trim()
    );
    const afterRoots = parse('- button "A" [ref=e9]');

    const current = StructuralTree.reconcile(
      beforeRoots,
      afterRoots
    ).toCurrentTree();

    expect(current.getRootNodes().map((node) => node.name)).toEqual(["A"]);
    expect(current.getNode(ref("e2"))).toBeNull();
  });

  it("returns an equivalent current tree for an unreconciled tree", () => {
    const tree = parse(
      `
- generic [ref=e1]:
  - button "Keep" [ref=e2]
`.trim()
    );

    const current = tree.toCurrentTree();

    expect(ids(current.getAllNodes())).toEqual(ids(tree.getAllNodes()));
    expect(current.hasAnyChanges()).toBe(false);
  });
});

describe("StructuralTree factory-identity reconciliation", () => {
  const SAME_HIERARCHY = `
- generic [ref=e1]:
  - textbox "Todo" [ref=e14]
`.trim();

  const MOVED_UNDER_WRAPPER = `
- generic [ref=e1]:
  - generic:
    - textbox "Todo" [ref=e14]
`.trim();

  it("retains a ref id when it stays in the same hierarchy", () => {
    const [before, after] = parsePair(SAME_HIERARCHY, SAME_HIERARCHY);
    const beforeId = before.getNode(ref("e14"))!.ref;

    const reconciled = StructuralTree.reconcile(before, after);

    expect(reconciled.getNode(ref("e14"))?.ref).toBe(beforeId);
  });

  it("retains a ref id when it moves beneath an inserted anonymous wrapper", () => {
    const [before, after] = parsePair(SAME_HIERARCHY, MOVED_UNDER_WRAPPER);
    const beforeId = before.getNode(ref("e14"))!.ref;

    const reconciled = StructuralTree.reconcile(before, after);
    const moved = reconciled.getNode(ref("e14"));

    expect(moved?.ref).toBe(beforeId);
    const parent = reconciled.getParentOf(moved!.ref);
    expect(parent?.role).toBe("generic");
    expect(parent?.status).toEqual({ kind: "added" });
  });

  it("emits the retained id exactly once with no removed duplicate at the old location", () => {
    const [before, after] = parsePair(SAME_HIERARCHY, MOVED_UNDER_WRAPPER);
    const beforeId = before.getNode(ref("e14"))!.ref;

    const reconciled = StructuralTree.reconcile(before, after);

    const occurrences = reconciled
      .getAllNodes()
      .filter((node) => node.ref === beforeId);
    expect(occurrences).toHaveLength(1);
    expect(reconciled.getNodesByStatus("removed")).toEqual([]);
  });

  it("reconciles mutually unique ref-bearing elements through role and name", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - button "Submit" [ref=e2]
`.trim(),
      `
- generic [ref=e1]:
  - button "Submit" [disabled] [ref=e3]
`.trim()
    );

    const reconciled = StructuralTree.reconcile(before, after);

    expect(reconciled.getNode(ref("e3"))?.status).toEqual({
      kind: "updated",
      selfChanged: true,
      childListChanged: false,
    });
    expect(reconciled.getBeforeNode(ref("e3"))?.ref).toBe(ref("e2"));
    expect(reconciled.getNodesByStatus("added")).toEqual([]);
    expect(reconciled.getNodesByStatus("removed")).toEqual([]);
  });

  it("still reconciles ref-less nodes with existing role+name heuristics", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - generic:
    - button "Go" [ref=e2]
`.trim(),
      `
- generic [ref=e1]:
  - generic:
    - button "Go" [disabled] [ref=e2]
`.trim()
    );

    const reconciled = StructuralTree.reconcile(before, after);
    const wrapper = reconciled
      .getRootNodes()[0]!
      .children.find(
        (child): child is StructuralNode => typeof child !== "string"
      )!;

    // The anonymous wrapper carries no cross-capture id, so role-identity heuristics keep it
    // reconciled in place rather than collapsing it to add/remove. Its child list and own data are unchanged.
    expect(wrapper.ref).toMatch(/^s_/);
    expect(wrapper.status).toEqual({ kind: "unchanged" });
    expect(reconciled.getNodesByStatus("added")).toEqual([]);
    expect(reconciled.getNodesByStatus("removed")).toEqual([]);
  });
});

describe("spike enrichment does not affect equality", () => {
  it("same node data with different enrichment is shallow-equal", () => {
    const a = expectNode(
      parse('- button "Create" [ref=e1]').root
    ).attachEnrichment(testEnrichment, enrichmentA);
    const b = expectNode(
      parse('- button "Create" [ref=e1]').root
    ).attachEnrichment(testEnrichment, enrichmentB);

    expect(a.isShallowEqual(b)).toBe(true);
  });

  it("same node data with different enrichment is deep-equal when children still equal", () => {
    const a = expectNode(
      parse(
        `
- button "Add party" [ref=e1]:
  - img [ref=e2]
  - text: Add party
`.trim()
      ).root
    ).attachEnrichment(testEnrichment, enrichmentA);
    const b = expectNode(
      parse(
        `
- button "Add party" [ref=e99]:
  - img [ref=e100]
  - text: Add party
`.trim()
      ).root
    ).attachEnrichment(testEnrichment, enrichmentB);

    expect(a.isDeepEqual(b)).toBe(true);
  });
});
