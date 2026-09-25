import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AriaRef } from "../tree/StructuralTypes";
import { AriaRefSchema } from "../tree/StructuralTypes";
import { projectStructuralNodeForest } from "./StructuralProjection";
import { renderCompactStructuralNodeForest } from "./CompactStructuralTreeRenderer";
import { structuralNodeForest } from "./StructuralNodeForest";
import { defineStructuralEnrichment } from "../tree/StructuralEnrichment";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { StructuralTree } from "../tree/StructuralTree";

function parse(yaml: string): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
}

function renderBase(tree: StructuralTree): string {
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest({
      roots: tree.root.role === "fragment" ? tree.root.children : [tree.root],
      structuralNode: (node) => node,
      children: (node) => node.children,
    })
  );
}

function renderIncremental(tree: StructuralTree, triggerRef?: AriaRef): string {
  const triggerPathRefs = new Set<AriaRef>();
  if (triggerRef !== undefined && tree.hasNode(triggerRef)) {
    triggerPathRefs.add(triggerRef);
    for (const ancestor of tree.getAncestorsOf(triggerRef))
      triggerPathRefs.add(ancestor.ref);
  }
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(
      {
        roots: tree.root.role === "fragment" ? tree.root.children : [tree.root],
        structuralNode: (node) => node,
        children: (node) => node.children,
        compact: (node) =>
          (node.status?.kind === "unchanged" ||
            node.status?.kind === "removed") &&
          !triggerPathRefs.has(node.ref),
      },
      {
        prefixes: (_entry, node) =>
          node.ref === triggerRef ? ["<trigger>"] : [],
      }
    )
  );
}

describe("CompactStructuralTreeRenderer", () => {
  it("does not separate a custom prefix from an empty generic header", () => {
    const tree = parse('- generic [ref=e1]:\n  - button "Save" [ref=e2]');
    const projected = projectStructuralNodeForest(
      {
        roots: tree.getRootNodes(),
        structuralNode: (node) => node,
        children: (node) => node.children,
      },
      { includeIdentity: false, prefixes: (node) => [node.ref] }
    );
    expect(renderCompactStructuralNodeForest(projected)).toBe(
      '- e1:\n  - e2 button "Save"'
    );
  });

  it("formats projected structural nodes", () => {
    expect(renderBase(parse('- button "Create" [ref=e1]'))).toBe(
      '- [ref=e1] button "Create"'
    );
  });

  it("formats every projected structural state", () => {
    const tree = parse(
      '- checkbox "Ready" [checked] [expanded] [active] [selected] [pressed] [level=2] [ref=e1] [cursor=pointer]\n' +
        '- checkbox "Partial" [checked=mixed] [pressed=mixed] [ref=e2]'
    );

    expect(renderBase(tree)).toBe(
      '- [ref=e1] checkbox "Ready" [checked] [expanded] [active] [selected] [pressed] [level=2] [cursor=pointer]\n' +
        '- [ref=e2] checkbox "Partial" [checked=mixed] [pressed=mixed]'
    );
  });

  it("formats projected properties and child text", () => {
    expect(
      renderBase(
        parse(
          '- link "Docs" [ref=e1]:\n  - /url: https://example.com/docs\n  - text: Docs'
        )
      )
    ).toBe(
      '- [ref=e1] link "Docs":\n  - /url: "https://example.com/docs"\n  - text: Docs'
    );
  });

  it("omits ordinary structural properties when the projection does not select them", () => {
    const tree = parse(
      '- link "Docs" [ref=e1]:\n  - /url: https://example.com/docs'
    );

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [tree.root],
          structuralNode: (node) => node,
          children: (node) => node.children,
        },
        { structuralProperties: [] }
      )
    );

    expect(rendered).toBe('- [ref=e1] link "Docs"');
  });

  it("discloses only the ordinary structural properties selected by the projection", () => {
    const tree = parse(
      '- link "Docs" [ref=e1]:\n  - /url: https://example.com/docs\n  - /target: _blank'
    );

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [tree.root],
          structuralNode: (node) => node,
          children: (node) => node.children,
        },
        { structuralProperties: ["url"] }
      )
    );

    expect(rendered).toBe(
      '- [ref=e1] link "Docs":\n  - /url: "https://example.com/docs"'
    );
  });

  it("uses the projection to select nodes and omit structural identities", () => {
    const tree = parse('- button "Keep" [ref=e1]\n- link "Omit" [ref=e2]');

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: tree.getRootNodes(),
          structuralNode: (node) => node,
          children: (node) => node.children,
        },
        {
          includeNode: (_entry, node) => node.role === "button",
          includeIdentity: false,
        }
      )
    );

    expect(rendered).toBe('- button "Keep"');
  });

  it("formats only the enrichment properties selected by the projection", () => {
    const component = defineStructuralEnrichment({
      key: "component",
      schema: z.object({ name: z.string(), category: z.string() }),
      properties: {
        name: (value) => value.name,
        category: (value) => value.category,
      },
      hasChanged: () => false,
    });
    const tree = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      new SyntheticAriaRefFactory()
    );
    const root = tree.root.attachEnrichment(component, {
      name: "SaveButton",
      category: "form",
    });

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [root],
          structuralNode: (node) => node,
          children: (node) => node.children,
        },
        { enrichment: [component.pick("name")] }
      )
    );

    expect(rendered).toBe('- [ref=e1] button "Save":\n  - /name: SaveButton');
  });

  it("preserves the compact path to a descendant with a projected property", () => {
    const tree = parse(
      '- generic [ref=e1]:\n  - generic [ref=e2]:\n    - button "Save" [ref=e3]\n  - button "Other" [ref=e4]'
    );

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [tree.root],
          structuralNode: (node) => node,
          children: (node) => node.children,
          compact: () => true,
        },
        {
          structuralProperties: [],
          properties: (_entry, node) =>
            node.ref === "e3"
              ? [
                  {
                    key: "consumer.label",
                    label: "label",
                    value: "Form.saveButton",
                  },
                ]
              : [],
        }
      )
    );

    expect(rendered).toBe(
      '- [ref=e1]:\n  - [ref=e2]:\n    - [ref=e3] button "Save":\n      - /label: Form.saveButton'
    );
  });

  it("preserves the contents of a retained noncompact child", () => {
    const tree = parse(
      "- generic [ref=e1]:\n" +
        "  - generic [ref=e2]:\n" +
        '    - button "Save" [ref=e3]\n' +
        '    - button "Other" [ref=e4]\n' +
        "    - text: unrelated text"
    );

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [tree.root],
          structuralNode: (node) => node,
          children: (node) => node.children,
          compact: (node) => node.ref === "e1",
        },
        {
          structuralProperties: [],
          properties: (_entry, node) =>
            node.ref === "e3"
              ? [
                  {
                    key: "consumer.label",
                    label: "label",
                    value: "Form.saveButton",
                  },
                ]
              : [],
        }
      )
    );

    expect(rendered).toBe(
      "- [ref=e1]:\n" +
        "  - [ref=e2]:\n" +
        '    - [ref=e3] button "Save":\n' +
        "      - /label: Form.saveButton\n" +
        '    - [ref=e4] button "Other"\n' +
        "    - text: unrelated text"
    );
  });

  it("does not retain a compact branch for a filtered-out property", () => {
    const tree = parse('- generic [ref=e1]:\n  - button "Save" [ref=e2]');

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [tree.root],
          structuralNode: (node) => node,
          children: (node) => node.children,
          compact: () => true,
        },
        {
          structuralProperties: [],
          properties: (_entry, node) =>
            node.ref === "e2"
              ? [
                  {
                    key: "consumer.label",
                    label: "label",
                    value: "Form.saveButton",
                  },
                ]
              : [],
          includeProperty: () => false,
        }
      )
    );

    expect(rendered).toBe("- [ref=e1]");
  });

  it("does not retain a compact branch through an excluded node", () => {
    const tree = parse(
      '- generic [ref=e1]:\n  - generic [ref=e2]:\n    - button "Save" [ref=e3]'
    );

    const rendered = renderCompactStructuralNodeForest(
      projectStructuralNodeForest(
        {
          roots: [tree.root],
          structuralNode: (node) => node,
          children: (node) => node.children,
          compact: () => true,
        },
        {
          structuralProperties: [],
          includeNode: (_entry, node) => node.ref !== "e2",
          properties: (_entry, node) =>
            node.ref === "e3"
              ? [
                  {
                    key: "consumer.label",
                    label: "label",
                    value: "Form.saveButton",
                  },
                ]
              : [],
        }
      )
    );

    expect(rendered).toBe("- [ref=e1]");
  });

  it("renders selected typed enrichment from the reconciled current tree", () => {
    const component = defineStructuralEnrichment({
      key: "component",
      schema: z.object({ name: z.string() }),
      properties: { name: (value) => value.name },
      hasChanged: (before, after) => before?.name !== after?.name,
    });
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    );
    const after = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    );
    const reconciled = StructuralTree.reconcile(
      before,
      new StructuralTree(
        after.root.attachEnrichment(component, { name: "SaveButton" }),
        factory
      )
    );
    const current = reconciled.toCurrentTree();

    expect(
      renderCompactStructuralNodeForest(
        projectStructuralNodeForest(
          {
            roots: [current.root],
            structuralNode: (node) => node,
            children: (node) => node.children,
          },
          { enrichment: [component.pick("name")] }
        )
      )
    ).toBe('- [ref=e1] button "Save":\n  - /name: SaveButton');
  });

  it("formats status tokens, trigger paths, and collapsed unchanged nodes from the projection", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- generic [ref=e1]:\n  - button "Cart" [ref=e2]\n  - button "Other" [ref=e3]',
      factory
    );
    const after = StructuralTree.fromAriaSnapshotYaml(
      '- generic [ref=e1]:\n  - button "Cart" [ref=e2]\n  - button "Other" [ref=e3] [disabled]',
      factory
    );

    expect(
      renderIncremental(
        StructuralTree.reconcile(before, after),
        AriaRefSchema.parse("e2")
      )
    ).toBe(
      '- [ref=e1]:\n  - <trigger> [ref=e2] button "Cart"\n  - <changed> [ref=e3] button "Other" [disabled]'
    );
  });

  it("retains reconciled refs in an added and removed rendered change tree", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- generic [ref=e1]:\n  - button "Old" [ref=e2]',
      factory
    );
    const after = StructuralTree.fromAriaSnapshotYaml(
      '- generic [ref=e1]:\n  - button "New" [ref=e3]',
      factory
    );

    expect(renderIncremental(StructuralTree.reconcile(before, after))).toBe(
      '- <changed> [ref=e1]:\n  - <added> [ref=e3] button "New"\n  - <removed> [ref=e2]'
    );
  });

  it("keeps adjacent text children and roots left by an exploded node separate", () => {
    const tree = parse(
      "- paragraph [ref=e1]:\n" +
        "  - generic [ref=e2]: a\n" +
        "  - generic [ref=e3]: b\n" +
        '  - button "Go" [ref=e4]\n' +
        "  - generic [ref=e5]: c\n" +
        "  - text: d\n" +
        "- generic [ref=e6]: e\n" +
        "- generic [ref=e7]: f"
    );
    const forest = structuralNodeForest(tree.getRootNodes()).explode(
      (_entry, node) => node.role === "generic"
    );

    expect(
      renderCompactStructuralNodeForest(projectStructuralNodeForest(forest))
    ).toBe(
      "- [ref=e1] paragraph:\n" +
        "  - text: a\n" +
        "  - text: b\n" +
        '  - [ref=e4] button "Go"\n' +
        "  - text: c\n" +
        "  - text: d\n" +
        "- text: e\n" +
        "- text: f"
    );
  });

  it("renders a run of text children in block form, one entry each", () => {
    const forest = structuralNodeForest(
      parse(
        '- button "Go" [ref=e1]:\n  - generic [ref=e2]: G\n  - generic [ref=e3]: o'
      ).getRootNodes()
    ).explode((_entry, node) => node.role === "generic");

    expect(
      renderCompactStructuralNodeForest(projectStructuralNodeForest(forest))
    ).toBe('- [ref=e1] button "Go":\n  - text: G\n  - text: o');
  });

  it("suppresses the synthetic fragment wrapper in multi-root projections", () => {
    expect(
      renderBase(parse('- button "First" [ref=e1]\n- button "Second" [ref=e2]'))
    ).toBe('- [ref=e1] button "First"\n- [ref=e2] button "Second"');
  });
});
