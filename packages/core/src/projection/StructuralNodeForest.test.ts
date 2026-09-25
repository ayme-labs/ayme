import { describe, expect, it } from "vitest";
import type { StructuralChild, StructuralNode } from "../tree/StructuralNode";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { renderCompactStructuralNodeForest } from "./CompactStructuralTreeRenderer";
import {
  StructuralNodeForest,
  structuralNodeForest,
  type StructuralNodeForestAdapter,
  type StructuralNodePredicate,
} from "./StructuralNodeForest";
import {
  projectStructuralNodeForest,
  type StructuralNodeForestSource,
} from "./StructuralProjection";

function forestOf(yaml: string): StructuralNodeForest<StructuralNode> {
  return structuralNodeForest(
    StructuralTree.fromAriaSnapshotYaml(
      yaml,
      new SyntheticAriaRefFactory()
    ).getRootNodes()
  );
}

/**
 * The structure of a forest, nothing else: a node is `[ref, ...children]`, a
 * text child is its string.
 */
function outline(
  forest: StructuralNodeForestSource<StructuralNode>
): unknown[] {
  const visit = (children: readonly StructuralChild[]): unknown[] =>
    children.map((child) =>
      typeof child === "string" ? child : [child.ref, ...visit(child.children)]
    );
  return visit(forest.roots);
}

const isButton: StructuralNodePredicate<StructuralNode> = (_entry, node) =>
  node.role === "button";
const isGeneric: StructuralNodePredicate<StructuralNode> = (_entry, node) =>
  node.role === "generic";
const isList: StructuralNodePredicate<StructuralNode> = (_entry, node) =>
  node.role === "list";

const PAGE =
  "- generic [ref=e1]:\n" +
  '  - button "Save" [ref=e2]\n' +
  "  - text: loose\n" +
  "  - list [ref=e3]:\n" +
  "    - listitem [ref=e4]:\n" +
  '      - button "Archive" [ref=e5]\n' +
  "      - text: label\n" +
  '  - link "Docs" [ref=e6]';

describe("StructuralNodeForest", () => {
  it("filter drops a non-matching node with its whole subtree", () => {
    const forest = forestOf(PAGE).filter(
      (_entry, node) => node.role !== "list"
    );

    expect(outline(forest)).toEqual([["e1", ["e2"], "loose", ["e6"]]]);
    // A root that does not match takes everything with it.
    expect(outline(forestOf(PAGE).filter(isButton))).toEqual([]);
  });

  it("filterAndPromote promotes the matching descendants of a dropped node and drops its text", () => {
    const forest = forestOf(PAGE).filterAndPromote(
      (_entry, node) => node.role === "generic" || node.role === "button"
    );

    // The list and its item are dropped; "Archive" rises into their place,
    // "loose" stays under the kept generic and "label" goes with the item.
    expect(outline(forest)).toEqual([["e1", ["e2"], "loose", ["e5"]]]);
  });

  it("filterAndPromote keeps text roots and drops a text child of a dropped root", () => {
    const tree = StructuralTree.fromAriaSnapshotYaml(
      '- generic [ref=e1]:\n  - text: dropped\n  - button "Save" [ref=e2]',
      new SyntheticAriaRefFactory()
    );
    const forest = structuralNodeForest([
      "kept",
      ...tree.getRootNodes(),
    ]).filterAndPromote(isButton);

    expect(outline(forest)).toEqual(["kept", ["e2"]]);
  });

  it("collapse keeps a matching node and drops all its children, text included", () => {
    const forest = forestOf(PAGE).collapse(isList);

    expect(outline(forest)).toEqual([["e1", ["e2"], "loose", ["e3"], ["e6"]]]);
  });

  it("collapse does not look below a collapsed node", () => {
    const visited: string[] = [];
    forestOf(PAGE).collapse((_entry, node) => {
      visited.push(node.ref);
      return node.role === "list";
    });

    expect(visited).toEqual(["e1", "e2", "e3", "e6"]);
  });

  it("explode replaces a matching node by its children, text included and in order", () => {
    const forest = forestOf(PAGE).explode(isList);

    expect(outline(forest)).toEqual([
      ["e1", ["e2"], "loose", ["e4", ["e5"], "label"], ["e6"]],
    ]);
  });

  it("explode evaluates the predicate bottom-up, on the node after its children were exploded", () => {
    const forest = forestOf(
      "- generic [ref=e1]:\n" +
        "  - generic [ref=e2]:\n" +
        "    - generic [ref=e3]:\n" +
        '      - button "Deep" [ref=e4]\n' +
        "    - generic [ref=e5]: a\n" +
        "    - generic [ref=e6]: b\n" +
        '  - button "Top" [ref=e7]'
    );
    const seen: { ref: string; children: string[] }[] = [];

    // A wrapper matches once its own children are only buttons and text; the
    // outermost wrapper sees the buttons its exploded descendants hoisted.
    const exploded = forest.explode((entry, node) => {
      seen.push({
        ref: node.ref,
        children: entry.children.map((child) =>
          typeof child === "string" ? child : child.ref
        ),
      });
      return (
        node.role === "generic" &&
        entry.children.every(
          (child) => typeof child === "string" || child.role === "button"
        )
      );
    });

    expect(outline(exploded)).toEqual([["e4"], "a", "b", ["e7"]]);
    expect(seen).toEqual([
      { ref: "e4", children: [] },
      { ref: "e3", children: ["e4"] },
      { ref: "e5", children: ["a"] },
      { ref: "e6", children: ["b"] },
      { ref: "e2", children: ["e4", "a", "b"] },
      { ref: "e7", children: [] },
      { ref: "e1", children: ["e4", "a", "b", "e7"] },
    ]);
  });

  it("explode leaves adjacent text children unjoined", () => {
    const forest = forestOf(
      "- paragraph [ref=e1]:\n  - generic [ref=e2]: a\n  - generic [ref=e3]: b\n  - text: c"
    ).explode(isGeneric);
    const [paragraph] = forest.roots;

    expect((paragraph as StructuralNode).children).toEqual(["a", "b", "c"]);
  });

  it("operations chain", () => {
    const forest = forestOf(PAGE).explode(isGeneric).collapse(isList);

    expect(outline(forest)).toEqual([["e2"], "loose", ["e3"], ["e6"]]);
  });

  it("keeps the node objects whose children did not change", () => {
    const original = forestOf(PAGE);
    const [root] = original.roots as StructuralNode[];
    const [save] = root!.children as StructuralNode[];

    const exploded = original.explode(isList);
    const [newRoot] = exploded.roots as StructuralNode[];

    expect(newRoot).not.toBe(root);
    expect(newRoot!.children[0]).toBe(save);
    expect(original.roots[0]).toBe(root);
  });

  it("carries the adapter's compact decision into the derived forest", () => {
    const tree = StructuralTree.fromAriaSnapshotYaml(
      PAGE,
      new SyntheticAriaRefFactory()
    );
    const forest = new StructuralNodeForest<StructuralNode>({
      roots: tree.getRootNodes(),
      children: (node) => node.children,
      structuralNode: (node) => node,
      withChildren: (node, children) => node.copy({ children: [...children] }),
      compact: (node) => node.role === "list",
    }).explode(isGeneric);

    expect(
      renderCompactStructuralNodeForest(projectStructuralNodeForest(forest))
    ).toBe(
      '- [ref=e2] button "Save"\n' +
        "- text: loose\n" +
        "- [ref=e3]\n" +
        '- [ref=e6] link "Docs"'
    );
  });

  it("runs every operation over a node type of its own through its adapter", () => {
    type Entry = { id: string; node: StructuralNode; kids: (Entry | string)[] };
    const tree = StructuralTree.fromAriaSnapshotYaml(
      PAGE,
      new SyntheticAriaRefFactory()
    );
    const wrap = (node: StructuralNode): Entry => ({
      id: `entry:${node.ref}`,
      node,
      kids: node.children.map((child) =>
        typeof child === "string" ? child : wrap(child)
      ),
    });
    const adapter: StructuralNodeForestAdapter<Entry> = {
      roots: tree.getRootNodes().map(wrap),
      children: (entry) => entry.kids,
      structuralNode: (entry) => entry.node,
      withChildren: (entry, kids) => ({ ...entry, kids: [...kids] }),
    };
    const forest = new StructuralNodeForest(adapter);
    const entryOutline = (children: readonly (Entry | string)[]): unknown[] =>
      children.map((child) =>
        typeof child === "string"
          ? child
          : [child.id, ...entryOutline(child.kids)]
      );

    expect(
      entryOutline(forest.filter((_entry, node) => node.role !== "list").roots)
    ).toEqual([["entry:e1", ["entry:e2"], "loose", ["entry:e6"]]]);
    expect(
      entryOutline(
        forest.filterAndPromote(
          (_entry, node) => node.role === "generic" || node.role === "button"
        ).roots
      )
    ).toEqual([["entry:e1", ["entry:e2"], "loose", ["entry:e5"]]]);
    expect(
      entryOutline(
        forest.collapse((_entry, node) => node.role === "list").roots
      )
    ).toEqual([
      ["entry:e1", ["entry:e2"], "loose", ["entry:e3"], ["entry:e6"]],
    ]);
    expect(
      entryOutline(forest.explode((_entry, node) => node.role === "list").roots)
    ).toEqual([
      [
        "entry:e1",
        ["entry:e2"],
        "loose",
        ["entry:e4", ["entry:e5"], "label"],
        ["entry:e6"],
      ],
    ]);
    // The result feeds the projection like any forest of that node type.
    expect(
      renderCompactStructuralNodeForest(
        projectStructuralNodeForest(
          forest.explode((_entry, node) => node.role === "list"),
          { includeIdentity: false, prefixes: (entry) => [entry.id] }
        )
      )
    ).toContain("- entry:e4 listitem:");
  });
});
