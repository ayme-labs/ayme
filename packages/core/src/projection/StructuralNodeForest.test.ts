import { describe, expect, it } from "vitest";
import type { StructuralNode } from "../tree/StructuralNode";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { renderCompactStructuralNodeForest } from "./CompactStructuralTreeRenderer";
import {
  StructuralNodeForest,
  joinAdjacentText,
  structuralNodeForest,
  type StructuralNodeForestAdapter,
  type StructuralNodePredicate,
} from "./StructuralNodeForest";
import { projectStructuralNodeForest } from "./StructuralProjection";

function forestOf(yaml: string): StructuralNodeForest<StructuralNode> {
  return structuralNodeForest(
    StructuralTree.fromAriaSnapshotYaml(
      yaml,
      new SyntheticAriaRefFactory()
    ).getRootNodes()
  );
}

/** The forest as the compact renderer shows it. */
function render(forest: StructuralNodeForest<StructuralNode>): string {
  return renderCompactStructuralNodeForest(projectStructuralNodeForest(forest));
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

    expect(render(forest)).toBe(
      "- [ref=e1]:\n" +
        '  - [ref=e2] button "Save"\n' +
        "  - text: loose\n" +
        '  - [ref=e6] link "Docs"'
    );
    // A root that does not match takes everything with it.
    expect(render(forestOf(PAGE).filter(isButton))).toBe("");
  });

  it("filterAndPromote promotes the matching descendants of a dropped node and drops its text", () => {
    const forest = forestOf(PAGE).filterAndPromote(
      (_entry, node) => node.role === "generic" || node.role === "button"
    );

    // The list and its item are dropped; "Archive" rises into their place,
    // "loose" stays under the kept generic and "label" goes with the item.
    expect(render(forest)).toBe(
      "- [ref=e1]:\n" +
        '  - [ref=e2] button "Save"\n' +
        "  - text: loose\n" +
        '  - [ref=e5] button "Archive"'
    );
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

    expect(render(forest)).toBe('- text: kept\n- [ref=e2] button "Save"');
  });

  it("collapse keeps a matching node and drops all its children, text included", () => {
    const forest = forestOf(PAGE).collapse(isList);

    expect(render(forest)).toBe(
      "- [ref=e1]:\n" +
        '  - [ref=e2] button "Save"\n' +
        "  - text: loose\n" +
        "  - [ref=e3] list\n" +
        '  - [ref=e6] link "Docs"'
    );
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

    expect(render(forest)).toBe(
      "- [ref=e1]:\n" +
        '  - [ref=e2] button "Save"\n' +
        "  - text: loose\n" +
        "  - [ref=e4] listitem:\n" +
        '    - [ref=e5] button "Archive"\n' +
        "    - text: label\n" +
        '  - [ref=e6] link "Docs"'
    );
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

    expect(render(exploded)).toBe(
      '- [ref=e4] button "Deep"\n- text: ab\n- [ref=e7] button "Top"'
    );
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

    expect(render(forest)).toBe(
      '- [ref=e2] button "Save"\n- text: loose\n- [ref=e3] list\n- [ref=e6] link "Docs"'
    );
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

  it("works over any node type through its adapter", () => {
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

    const forest = new StructuralNodeForest(adapter).explode(
      (_entry, node) => node.role === "list"
    );
    const [root] = forest.roots as Entry[];

    expect(root!.id).toBe("entry:e1");
    expect(
      root!.kids.map((kid) => (typeof kid === "string" ? kid : kid.id))
    ).toEqual(["entry:e2", "loose", "entry:e4", "entry:e6"]);
    expect(
      renderCompactStructuralNodeForest(
        projectStructuralNodeForest(forest, {
          includeIdentity: false,
          prefixes: (entry) => [entry.id],
        })
      )
    ).toContain("- entry:e4 listitem:");
  });
});

describe("joinAdjacentText", () => {
  it("joins runs of strings and leaves nodes between them", () => {
    expect(joinAdjacentText(["a", "b", 1, "c", 2, 3, "d", "e", "f"])).toEqual([
      "ab",
      1,
      "c",
      2,
      3,
      "def",
    ]);
  });

  it("keeps a list without adjacent strings as it is", () => {
    expect(joinAdjacentText(["a", 1, "b"])).toEqual(["a", 1, "b"]);
    expect(joinAdjacentText([])).toEqual([]);
  });
});
