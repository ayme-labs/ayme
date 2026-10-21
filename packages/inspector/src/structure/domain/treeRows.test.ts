import { describe, expect, it } from "vitest";

import type { StructureNode } from "./structure";
import { treeRows, type TreeRow, unfoldedOnPage } from "./treeRows";

// Unit tests: the rows the Structure lens shows, with chains of generic
// wrappers folded. The fixture is hand-written.

const generic = (
  ref: string,
  children: StructureNode[] = [],
  extra: Partial<StructureNode> = {}
): StructureNode => ({
  ref,
  role: "generic",
  name: "",
  members: [],
  children,
  ...extra,
});
const button = (ref: string, name: string): StructureNode => ({
  ref,
  role: "button",
  name,
  members: [],
  children: [],
});

/** Each row as `depth ref`, a folded one as `depth outer…ref (+hidden)`. */
const shape = (rows: readonly TreeRow[]) =>
  rows.map(({ node, depth, folded, unfolded }) =>
    [
      depth,
      folded
        ? `${folded.outer.ref}…${node.ref} (+${folded.hidden})`
        : `${node.ref ?? node.name}${unfolded ? " ▾" : ""}`,
    ].join(" ")
  );

const closed = () => false;

describe("treeRows", () => {
  it("folds a chain of wrappers into the generic it ends in, counting the ones between", () => {
    const tree = [
      generic("e1", [
        generic("e2", [
          generic("e3", [button("e4", "Save"), button("e5", "Cancel")]),
        ]),
      ]),
    ];

    expect(shape([...treeRows(tree, closed)])).toEqual([
      "0 e1…e3 (+1)",
      "1 e4",
      "1 e5",
    ]);
  });

  it("folds a single wrapper into its generic child, hiding nothing", () => {
    const tree = [generic("e1", [generic("e2", [button("e3", "Save")])])];

    expect(shape([...treeRows(tree, closed)])).toEqual([
      "0 e1…e2 (+0)",
      "1 e3",
    ]);
  });

  it("keeps a generic that wraps something other than one generic", () => {
    const tree = [
      generic("e1", [button("e2", "Save")]),
      generic("e3", [generic("e4"), generic("e5")]),
      generic("e6", [{ role: "text", name: "Hi", members: [], children: [] }]),
    ];

    expect(shape([...treeRows(tree, closed)])).toEqual([
      "0 e1",
      "1 e2",
      "0 e3",
      "1 e4",
      "1 e5",
      "0 e6",
      "1 Hi",
    ]);
  });

  it("keeps a generic that has a name or a Page Object member", () => {
    const tree = [
      generic("e1", [generic("e2", [button("e3", "Save")])], { name: "Bar" }),
      generic("e4", [generic("e5", [button("e6", "Save")])], {
        members: ["Page.toolbar"],
      }),
    ];

    expect(shape([...treeRows(tree, closed)])).toEqual([
      "0 e1",
      "1 e2",
      "2 e3",
      "0 e4",
      "1 e5",
      "2 e6",
    ]);
  });

  it("ends a chain in a generic with a member, which the folded row shows", () => {
    const tree = [
      generic("e1", [generic("e2", [button("e3", "Save")], { tag: ".bar" })]),
    ];

    const [row] = treeRows(tree, closed);

    expect(row?.node.tag).toBe(".bar");
    expect(row?.folded?.outer.ref).toBe("e1");
  });

  it("folds nested chains on their own", () => {
    const tree = [
      generic("e1", [
        generic("e2", [
          button("e3", "Save"),
          generic("e4", [generic("e5", [generic("e6", [button("e7", "")])])]),
        ]),
      ]),
    ];

    expect(shape([...treeRows(tree, closed)])).toEqual([
      "0 e1…e2 (+0)",
      "1 e3",
      "1 e4…e6 (+1)",
      "2 e7",
    ]);
  });

  it("unfolds the chains it is told are open, every wrapper on its own row", () => {
    const tree = [
      generic("e1", [generic("e2", [generic("e3", [button("e4", "Save")])])]),
    ];

    const asked: string[][] = [];
    const rows = [
      ...treeRows(tree, (chain) => {
        asked.push(chain.map(({ ref }) => ref ?? ""));
        return true;
      }),
    ];

    expect(asked).toEqual([["e1", "e2", "e3"]]);
    expect(shape(rows)).toEqual(["0 e1 ▾", "1 e2", "2 e3", "3 e4"]);
  });

  it("puts the node after an unfolded chain back at the chain's depth", () => {
    const tree = [
      generic("e1", [generic("e2", [button("e3", "Save")])]),
      button("e4", "Next"),
    ];

    expect(shape([...treeRows(tree, () => true)])).toEqual([
      "0 e1 ▾",
      "1 e2",
      "2 e3",
      "0 e4",
    ]);
  });

  it("keeps a generic an agent reads more of than its line: states, properties or a pointer cursor", () => {
    const tree = [
      generic("e1", [generic("e2", [button("e3", "Save")])], {
        state: { expanded: true },
      }),
      generic("e4", [generic("e5", [button("e6", "Save")])], {
        pageStateLines: ["- e4:", '  - /pom: "Toolbar"'],
      }),
      generic("e7", [generic("e8", [button("e9", "Save")])], {
        cursorPointer: true,
      }),
    ];

    expect(shape([...treeRows(tree, closed)])).toEqual([
      "0 e1",
      "1 e2",
      "2 e3",
      "0 e4",
      "1 e5",
      "2 e6",
      "0 e7",
      "1 e8",
      "2 e9",
    ]);
  });
});

describe("unfoldedOnPage", () => {
  const tree = [generic("e1", [generic("e2", [button("e3", "Save")])])];

  it("forgets the chains whose outermost wrapper left the page", () => {
    expect([...unfoldedOnPage(new Set(["e1", "e9"]), tree)]).toEqual(["e1"]);
  });

  it("keeps the same set while every chain is on the page", () => {
    const unfolded = new Set(["e1"]);

    expect(unfoldedOnPage(unfolded, tree)).toBe(unfolded);
  });

  it("forgets every chain when the page holds no nodes", () => {
    expect([...unfoldedOnPage(new Set(["e1"]), [])]).toEqual([]);
  });
});
