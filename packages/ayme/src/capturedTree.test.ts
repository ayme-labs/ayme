import { describe, it, expect } from "vitest";
import {
  AriaRefSchema,
  StructuralNode,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { parseCapturedTree } from "./capturedTree";
import { placeCapturedRoots } from "./pomRootPlacement";
const ref = AriaRefSchema.parse;
describe("Playwright page-state construction", () => {
  it("promotes text and nodes in order without leaking wrapper names or properties", () => {
    const tree = parseCapturedTree(
      "- generic [ref=e1]:\n" +
        '  - generic "Omitted":\n' +
        "    - /url: hidden\n" +
        '    - text: "literal [ref=e99]"\n' +
        '    - button "Save" [ref=e2]\n' +
        "    - generic: trailing\n" +
        '  - link "Docs" [ref=e3]:\n' +
        '    - /url: "https://example.com/[ref=e99]"',
      new SyntheticAriaRefFactory()
    );
    expect(tree.getAllRefs()).toEqual(["e1", "e2", "e3"]);
    expect(
      tree.root.children.map((child) =>
        typeof child === "string" ? child : child.ref
      )
    ).toEqual(["literal [ref=e99]", "e2", "trailing", "e3"]);
    expect(tree.root.props).toEqual({});
    expect(tree.getNode(ref("e3"))?.props).toEqual({
      url: "https://example.com/[ref=e99]",
    });
  });

  it("keeps captured refs that resemble temporary parser refs", () => {
    const tree = parseCapturedTree(
      '- generic:\n  - button "Save" [ref=s_webmcp_parse_1]',
      new SyntheticAriaRefFactory()
    );
    expect(tree.getAllRefs()).toEqual(["s_webmcp_parse_1"]);
    expect(tree.root.name).toBe("Save");
  });

  it("adopts real refs while promoting ref-less wrappers and omitting ref-less leaves", () => {
    const factory = new SyntheticAriaRefFactory();
    const tree = parseCapturedTree(
      `
- generic [ref=e1]:
  - generic:
    - button "Retained" [ref=e2]
  - generic "Unsupported"
`.trim(),
      factory
    );

    expect(tree.getAllRefs()).toEqual(["e1", "e2"]);
    expect(factory.create()).toBe("s_1");
  });

  it("restores an omitted real root in captured sibling order", () => {
    const factory = new SyntheticAriaRefFactory();
    const retained = parseCapturedTree(
      `
- generic [ref=e1]:
  - button "Before" [ref=e2]
  - button "After" [ref=e4]
`.trim(),
      factory
    );
    const full = parseCapturedTree(
      `
- generic [ref=e1]:
  - button "Before" [ref=e2]
  - generic "POM root" [ref=e3]
  - button "After" [ref=e4]
`.trim(),
      factory
    );

    const placed = placeCapturedRoots(
      retained,
      full,
      [{ kind: "referenced", ref: ref("e3") }],
      factory
    );

    expect(placed.refs).toEqual(["e3"]);
    expect(
      placed.tree.root.children
        .filter((child): child is StructuralNode => typeof child !== "string")
        .map((child) => child.ref)
    ).toEqual(["e2", "e3", "e4"]);
  });

  it("mints one synthetic ref for an anchored omitted root with a retained descendant", () => {
    const factory = new SyntheticAriaRefFactory();
    const retained = parseCapturedTree(
      `
- generic [ref=e1]:
  - button "Before" [ref=e2]
  - button "Nested" [ref=e3]
  - button "After" [ref=e4]
`.trim(),
      factory
    );
    const full = parseCapturedTree(
      `
- generic [ref=e1]:
  - button "Before" [ref=e2]
  - generic "POM root":
    - button "Nested" [ref=e3]
  - button "After" [ref=e4]
`.trim(),
      factory
    );

    const placed = placeCapturedRoots(
      retained,
      full,
      [
        {
          kind: "omitted",
          ancestorRef: ref("e1"),
          descendantRefs: [ref("e3")],
          role: "generic",
          name: "POM root",
        },
      ],
      factory
    );

    expect(placed.refs).toEqual(["s_1"]);
    expect(placed.tree.getNode(ref("s_1"))?.children).toEqual([
      retained.getNode(ref("e3")),
    ]);
    expect(placed.tree.getAllRefs()).toEqual(["e1", "e2", "s_1", "e3", "e4"]);
  });

  it("does not mint a ref for an unsupported omitted leaf root", () => {
    const factory = new SyntheticAriaRefFactory();
    const tree = parseCapturedTree("- generic [ref=e1]", factory);

    const placed = placeCapturedRoots(
      tree,
      tree,
      [
        {
          kind: "omitted",
          ancestorRef: ref("e1"),
          descendantRefs: [],
          role: "generic",
          name: "Leaf",
        },
      ],
      factory
    );

    expect(placed.refs).toEqual([null]);
    expect(placed.tree.getAllRefs()).toEqual(["e1"]);
    expect(factory.create()).toBe("s_1");
  });
});
